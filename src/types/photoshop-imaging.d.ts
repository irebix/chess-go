import "photoshop";

declare module "photoshop" {
  interface PhotoshopImageData {
    width: number;
    height: number;
    colorSpace: string;
    components: number;
    componentSize: number;
    dispose(): void;
  }

  interface PhotoshopPixelResult {
    imageData: PhotoshopImageData;
    sourceBounds: { left: number; top: number; right: number; bottom: number };
    level: number;
  }

  interface PhotoshopImagingApi {
    getPixels(options: {
      documentID: number;
      layerID: number;
      targetSize?: { width?: number; height?: number };
      colorSpace?: "RGB";
      colorProfile?: string;
      componentSize?: 8 | 16 | 32;
      applyAlpha?: boolean;
    }): Promise<PhotoshopPixelResult>;
    encodeImageData(options: {
      imageData: PhotoshopImageData;
      base64?: boolean;
    }): Promise<number[] | string>;
  }

  export const imaging: PhotoshopImagingApi | undefined;
  export const imaging_beta: PhotoshopImagingApi | undefined;
}

export {};
