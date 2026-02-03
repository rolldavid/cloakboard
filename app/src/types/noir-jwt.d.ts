declare module 'noir-jwt' {
  interface GenerateInputsParams {
    jwt: string;
    pubkey: JsonWebKey;
    shaPrecomputeTillKeys: string[];
    maxSignedDataLength: number;
  }

  interface GenerateInputsResult {
    partial_data: { storage: number[]; len: number };
    partial_hash: string[];
    full_data_length: string;
    base64_decode_offset: string;
    pubkey_modulus_limbs: string[];
    redc_params_limbs: string[];
    signature_limbs: string[];
  }

  export function generateInputs(params: GenerateInputsParams): Promise<GenerateInputsResult>;
}
