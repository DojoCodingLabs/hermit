Pod::Spec.new do |s|
  s.name           = 'HermitApprovalKey'
  s.version        = '0.1.0'
  s.summary        = 'The approval key in the Secure Enclave: P-256, Face ID or Touch ID for every signature.'
  s.description    = 'The approval key in the Secure Enclave: P-256, Face ID or Touch ID for every signature.'
  s.license        = 'Apache-2.0'
  s.author         = 'Hermit contributors'
  s.homepage       = 'https://github.com/DojoCodingLabs/hermit'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'LocalAuthentication', 'Security'

  s.source_files = "**/*.swift"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
