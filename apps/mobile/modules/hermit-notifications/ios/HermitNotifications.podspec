Pod::Spec.new do |s|
  s.name           = 'HermitNotifications'
  s.version        = '0.1.0'
  s.summary        = 'On iOS, for now: device facts, thermal state, power, screen and SHA-256 for the Device lab.'
  s.description    = 'On iOS, for now: device facts, thermal state, power, screen and SHA-256 for the Device lab.'
  s.license        = 'Apache-2.0'
  s.author         = 'Hermit contributors'
  s.homepage       = 'https://github.com/DojoCodingLabs/hermit'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.swift"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
