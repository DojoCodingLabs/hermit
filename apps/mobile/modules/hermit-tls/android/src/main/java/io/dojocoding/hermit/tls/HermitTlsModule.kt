package io.dojocoding.hermit.tls

import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SNIHostName
import javax.net.ssl.SNIServerName
import javax.net.ssl.SSLPeerUnverifiedException
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

/**
 * Q46, Q158: TLS sockets for IMAP and SMTP on Android's own TLS stack and the system's trusted roots, with no
 * third-party code. Before JavaScript can read or write a byte, each connection has checked the certificate chain and
 * the host name, twice: endpoint identification in the handshake, then Android's default HostnameVerifier, because
 * Android's SSLSocket checks no host name by itself. SNI is sent; only TLS 1.2 and 1.3 are allowed. A plain
 * connection exists only for SMTP's STARTTLS on 587 (the JavaScript side enforces the ports), and startTls upgrades
 * it with the same checks. Blocking work runs on this module's own threads; bytes cross as base64.
 */
class HermitTlsModule : Module() {
  private class Conn(val host: String, val port: Int, @Volatile var socket: Socket) {
    @Volatile var input: InputStream = socket.getInputStream()
    @Volatile var output: OutputStream = socket.getOutputStream()
  }

  private val conns = ConcurrentHashMap<Int, Conn>()
  private val ids = AtomicInteger(0)
  private val io: ExecutorService = Executors.newCachedThreadPool { r -> Thread(r, "hermit-tls").apply { isDaemon = true } }

  private fun background(promise: Promise, code: String, work: () -> Any?) {
    io.execute {
      try {
        promise.resolve(work())
      } catch (e: Exception) {
        promise.reject(code, e.message ?: e.javaClass.simpleName, e)
      }
    }
  }

  private fun secure(plain: Socket, host: String, port: Int): SSLSocket {
    val factory = SSLSocketFactory.getDefault() as SSLSocketFactory
    val ssl = factory.createSocket(plain, host, port, true) as SSLSocket
    try {
      val protocols = ssl.supportedProtocols.filter { it == "TLSv1.3" || it == "TLSv1.2" }
      check(protocols.isNotEmpty()) { "no TLS 1.2 or 1.3 on this phone" }
      ssl.enabledProtocols = protocols.toTypedArray()
      val params = ssl.sslParameters
      params.endpointIdentificationAlgorithm = "HTTPS"
      params.serverNames = listOf<SNIServerName>(SNIHostName(host))
      ssl.sslParameters = params
      ssl.useClientMode = true
      ssl.soTimeout = plain.soTimeout
      ssl.startHandshake()
      if (!HttpsURLConnection.getDefaultHostnameVerifier().verify(host, ssl.session)) {
        throw SSLPeerUnverifiedException("the certificate isn't for $host")
      }
      return ssl
    } catch (e: Exception) {
      runCatching { ssl.close() }
      throw e
    }
  }

  private fun conn(id: Int): Conn = conns[id] ?: throw IllegalStateException("the connection is closed")

  override fun definition() = ModuleDefinition {
    Name("HermitTls")

    AsyncFunction("open") { host: String, port: Int, timeoutMs: Int, tls: Boolean, promise: Promise ->
      background(promise, "ERR_TLS_OPEN") {
        val plain = Socket()
        try {
          plain.connect(InetSocketAddress(host, port), timeoutMs)
          plain.soTimeout = timeoutMs
          val socket: Socket = if (tls) secure(plain, host, port) else plain
          val id = ids.incrementAndGet()
          conns[id] = Conn(host, port, socket)
          id
        } catch (e: Exception) {
          runCatching { plain.close() }
          throw e
        }
      }
    }

    AsyncFunction("startTls") { id: Int, promise: Promise ->
      background(promise, "ERR_TLS_START") {
        val c = conn(id)
        check(c.socket !is SSLSocket) { "already TLS" }
        val ssl = secure(c.socket, c.host, c.port)
        c.socket = ssl
        c.input = ssl.inputStream
        c.output = ssl.outputStream
        null
      }
    }

    AsyncFunction("write") { id: Int, data: String, promise: Promise ->
      background(promise, "ERR_TLS_WRITE") {
        val c = conn(id)
        c.output.write(Base64.decode(data, Base64.NO_WRAP))
        c.output.flush()
        null
      }
    }

    AsyncFunction("read") { id: Int, max: Int, promise: Promise ->
      background(promise, "ERR_TLS_READ") {
        val c = conn(id)
        val buf = ByteArray(max.coerceIn(1, 65_536))
        val n = c.input.read(buf)
        if (n < 0) null else Base64.encodeToString(buf, 0, n, Base64.NO_WRAP)
      }
    }

    Function("close") { id: Int ->
      conns.remove(id)?.let { c -> runCatching { c.socket.close() } }
      Unit
    }

    OnDestroy {
      conns.values.forEach { c -> runCatching { c.socket.close() } }
      conns.clear()
      io.shutdownNow()
    }
  }
}
