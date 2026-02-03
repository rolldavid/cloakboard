// Fix for Node.js 22+ where Uint8Array became generic,
// causing type incompatibility with SubtleCrypto.digest()
interface SubtleCrypto {
  digest(algorithm: AlgorithmIdentifier, data: Uint8Array | ArrayBuffer): Promise<ArrayBuffer>;
}
