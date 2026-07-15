declare module "uxp" {
  const shell: {
    openExternal(url: string, developerText?: string): Promise<string>;
  };

  namespace storage {
    const formats: {
      binary: string;
      utf8: string;
    };

    interface EntryMetadata {
      size?: number;
      dateModified?: Date;
    }

    interface File {
      name: string;
      url?: string | { href?: string; toString(): string };
      isFile?: boolean;
      nativePath?: string;
      read(options?: { format?: string }): Promise<ArrayBuffer | string>;
      write(data: ArrayBuffer | Uint8Array | string, options?: { format?: string }): Promise<void>;
      delete(): Promise<void>;
      getMetadata?(): Promise<EntryMetadata>;
    }

    interface Folder {
      name?: string;
      isFile?: boolean;
      isFolder?: boolean;
      createFile(name: string, options?: { overwrite?: boolean }): Promise<File>;
      getEntry?(name: string): Promise<File | Folder>;
      getEntries?(): Promise<Array<File | Folder>>;
    }

    interface FileSystemProvider {
      getFileForOpening(options?: { types?: string[]; allowMultiple?: boolean }): Promise<File | File[] | null>;
      getFileForSaving(suggestedName: string, options?: { types?: string[] }): Promise<File | null>;
      getTemporaryFolder(): Promise<Folder>;
      getPluginFolder?(): Promise<Folder>;
      getFolder(): Promise<Folder | null>;
      getFsUrl?(entry: File | Folder): string | { href?: string; toString(): string };
      getNativePath?(entry: File | Folder): string;
      getEntryWithUrl?(url: string): Promise<File | Folder>;
      createSessionToken(entry: File): string;
      createPersistentToken?(entry: File | Folder): Promise<string>;
      getEntryForPersistentToken?(token: string): Promise<File | Folder>;
    }

    const localFileSystem: FileSystemProvider;
  }
}
