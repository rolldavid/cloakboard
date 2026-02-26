export interface KeeperEntry {
  cloakAddress: string;
  cloakName: string;
  cloakSlug: string;
  tallyMode: number; // 0=open, 1=sealed
  senderAddresses: string[]; // For vote note discovery
}
