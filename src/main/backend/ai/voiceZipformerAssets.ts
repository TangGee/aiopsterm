export const voiceEngineVersion = '1.12.40'
export const zipformerModelName = 'sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30'
export const punctuationModelName = 'sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8'

const packages: Record<string, string> = {
  "sherpa-onnx-node": "a5880e4a93f281eaba40a3eaf033a42c21746eeec3439bcd02e1160994bd7af0",
  "sherpa-onnx-linux-x64": "6be856f47c49a0d5491592426234201b8492c20decc167312f10892e6204b65f",
  "sherpa-onnx-linux-arm64": "8bb3b86f2d2255f8fda6aa583eef30be9749ca2e9aac7338e51d865a05840ab5",
  "sherpa-onnx-darwin-x64": "37b93a9476a419efd1de0dfd953a3bc25f7290e5d02e341b2d277dca64207ce8",
  "sherpa-onnx-darwin-arm64": "a3e5bc07933c0192a627795092a11cdf0c124e22290accd552349e300761b5d3",
  "sherpa-onnx-win-x64": "dc8e9b0d7cb017584e60c747e9666362dde5f632697a6ed211c731464753f04c"
}

export type VoiceInstallAsset = {
  kind: 'engine' | 'model' | 'punctuation'; name: string; url: string; sha256: string; assetId?: number; packageName?: string
}
export const voiceInstallEnvironment = (platform = process.platform, arch: string = process.arch) => ({
  platform, arch, autoInstallSupported: Boolean(packages[`sherpa-onnx-${platform === 'win32' ? 'win' : platform}-${arch}`])
})
export const voiceInstallAssets = (platform = process.platform, arch: string = process.arch): VoiceInstallAsset[] => {
  if (!voiceInstallEnvironment(platform, arch).autoInstallSupported) throw new Error('Automatic installation is unavailable for this architecture.')
  return [
    ...['sherpa-onnx-node', `sherpa-onnx-${platform === 'win32' ? 'win' : platform}-${arch}`].map(packageName => ({
      kind: 'engine' as const, packageName, name: `${packageName}-${voiceEngineVersion}.tgz`,
      url: `https://registry.npmjs.org/${packageName}/-/${packageName}-${voiceEngineVersion}.tgz`, sha256: packages[packageName]
    })),
    { kind: 'model', name: `${zipformerModelName}.tar.bz2`, assetId: 268558776,
      url: `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${zipformerModelName}.tar.bz2`,
      sha256: '5a2832047ea1f97dd0dc595b816c230c4bafad65cfc0341fa57517cadc50afd0' },
    { kind: 'punctuation', name: `${punctuationModelName}.tar.bz2`, assetId: 264954276,
      url: `https://github.com/k2-fsa/sherpa-onnx/releases/download/punctuation-models/${punctuationModelName}.tar.bz2`,
      sha256: 'c0d5aa5f8eeb686032345e180bedf39319dc2e0556781c6264bcadba8328a6e1' }
  ]
}
