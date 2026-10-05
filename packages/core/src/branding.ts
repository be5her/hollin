import brandingJson from '../../../branding.json';

/** The product's names, from branding.json at the repository root. Nothing else spells them out. */
export interface Branding {
  productName: string;
  shortName: string;
  description: string;
  appId: string;
  /** Folder name under the OS app-data directory. Kept stable across renames so existing data survives. */
  dataDirName: string;
  /** File extension of exported project packages, without the dot. */
  packageExtension: string;
  /** Server name reported to MCP clients and used in their config snippets. */
  mcpServerName: string;
  defaultMcpPort: number;
}

export const BRANDING: Readonly<Branding> = Object.freeze({
  productName: brandingJson.productName,
  shortName: brandingJson.shortName,
  description: brandingJson.description,
  appId: brandingJson.appId,
  dataDirName: brandingJson.dataDirName,
  packageExtension: brandingJson.packageExtension,
  mcpServerName: brandingJson.mcpServerName,
  defaultMcpPort: brandingJson.defaultMcpPort,
});
