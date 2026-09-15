import "server-only";

export type FolderIdentity = { workspaceId: string; logicalKey: string; parentId: string };
export type FolderReservation = {
  workspace_id: string;
  logical_key: string;
  parent_drive_folder_id: string;
  drive_folder_id: string | null;
  status: "creating" | "ready";
  claimed?: boolean;
};
export interface FolderRegistry {
  claim(identity: FolderIdentity, token: string): Promise<FolderReservation>;
  reserve(identity: FolderIdentity, token: string, id: string): Promise<FolderReservation | null>;
  ready(identity: FolderIdentity, token: string, id: string): Promise<boolean>;
}
