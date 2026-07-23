import * as photoshop from "photoshop";
import { action, app, constants, core } from "photoshop";
import { classifyNestedSubpaths } from "./pathGeometry";
import { validatePathJson } from "./pathJson";
import type {
  CenterlineCoordinate,
  CenterlinePathJson,
  CenterlinePixelTransform
} from "./types";
import { alignResultToSource } from "../photoshop/layerPlacementGeometry";

interface PhotoshopPathPointInfo {
  anchor: CenterlineCoordinate;
  leftDirection: CenterlineCoordinate;
  rightDirection: CenterlineCoordinate;
  kind: unknown;
}

interface PhotoshopSubPathInfo {
  closed: boolean;
  operation: unknown;
  entireSubPath: PhotoshopPathPointInfo[];
}

interface PhotoshopPathItem {
  id?: number;
  name: string;
}

interface PhotoshopPathDomItem extends PhotoshopPathItem {
  remove?: () => Promise<void> | void;
}

interface PhotoshopPathItems {
  length: number;
  [index: number]: PhotoshopPathDomItem;
  add(
    name: string,
    subpaths: PhotoshopSubPathInfo[]
  ): PhotoshopPathDomItem | Promise<PhotoshopPathDomItem>;
}

type EmptyConstructor<T> = new () => T;

function pathConstructors(): {
  PointCtor: EmptyConstructor<PhotoshopPathPointInfo>;
  SubPathCtor: EmptyConstructor<PhotoshopSubPathInfo>;
} {
  const module = photoshop as unknown as {
    PathPointInfo?: EmptyConstructor<PhotoshopPathPointInfo>;
    SubPathInfo?: EmptyConstructor<PhotoshopSubPathInfo>;
  };
  const application = app as unknown as {
    PathPointInfo?: EmptyConstructor<PhotoshopPathPointInfo>;
    SubPathInfo?: EmptyConstructor<PhotoshopSubPathInfo>;
  };
  const PointCtor = module.PathPointInfo ?? application.PathPointInfo;
  const SubPathCtor = module.SubPathInfo ?? application.SubPathInfo;
  if (!PointCtor || !SubPathCtor) {
    throw new Error("当前 Photoshop 未暴露路径构造器；请使用 Photoshop 23.3 或更高版本。");
  }
  return { PointCtor, SubPathCtor };
}

function assertDocument(documentId: number): void {
  if (!app.documents?.length || app.activeDocument.id !== documentId) {
    throw new Error("任务执行期间活动文档已改变；已停止写入 Photoshop。");
  }
}

function transformCoordinate(
  coordinate: CenterlineCoordinate,
  transform: CenterlinePixelTransform
): CenterlineCoordinate {
  return [
    coordinate[0] * transform.scaleX + transform.offsetX,
    coordinate[1] * transform.scaleY + transform.offsetY
  ];
}

function makeSubPathInfos(
  payload: CenterlinePathJson,
  transform: CenterlinePixelTransform
): PhotoshopSubPathInfo[] {
  const { PointCtor, SubPathCtor } = pathConstructors();
  const operations = classifyNestedSubpaths(payload.paths);
  const pointKind = constants as unknown as {
    PointKind: { SMOOTHPOINT: unknown; CORNERPOINT: unknown };
    ShapeOperation: { SHAPESUBTRACT: unknown; SHAPEADD: unknown };
  };
  return payload.paths.map((path, pathIndex) => {
    const points = path.points.map((sourcePoint) => {
      const point = new PointCtor();
      point.anchor = transformCoordinate(sourcePoint.anchor, transform);
      point.leftDirection = transformCoordinate(sourcePoint.rightDirection, transform);
      point.rightDirection = transformCoordinate(sourcePoint.leftDirection, transform);
      point.kind = sourcePoint.kind === "smooth"
        ? pointKind.PointKind.SMOOTHPOINT
        : pointKind.PointKind.CORNERPOINT;
      return point;
    });
    const subPath = new SubPathCtor();
    subPath.closed = path.closed;
    subPath.operation = operations[pathIndex] === "subtract"
      ? pointKind.ShapeOperation.SHAPESUBTRACT
      : pointKind.ShapeOperation.SHAPEADD;
    subPath.entireSubPath = points;
    return subPath;
  });
}

async function deselectPathUiInsideModal(): Promise<void> {
  await action.batchPlay([{
    _obj: "deselect",
    _target: [{ _ref: "path", _enum: "ordinal", _value: "targetEnum" }],
    _options: { dialogOptions: "dontDisplay" }
  }], {});
}

export async function createEditableWorkPath(
  payload: CenterlinePathJson,
  name: string,
  transform: CenterlinePixelTransform,
  options: { keepSelected?: boolean; documentId: number }
): Promise<PhotoshopPathItem> {
  const validated = validatePathJson(payload);
  let createdPath: PhotoshopPathItem | null = null;
  await core.executeAsModal(async () => {
    assertDocument(options.documentId);
    const document = app.activeDocument as unknown as {
      pathItems: PhotoshopPathItems;
    };
    const suffix = new Date().toISOString().replace(/[:.]/g, "-");
    const pathName = `${name} ${suffix}`;
    const addedPath = await Promise.resolve(
      document.pathItems.add(pathName, makeSubPathInfos(validated, transform))
    );
    createdPath = {
      id: Number.isFinite(addedPath?.id) ? addedPath.id : undefined,
      name: pathName
    };
    if (!options.keepSelected) {
      try {
        await deselectPathUiInsideModal();
      } catch (error) {
        console.warn("工作路径已创建，但 Photoshop 无法隐藏路径编辑叠加层。", error);
      }
    }
  }, { commandName: "AI勾线 · 创建可编辑路径" });
  if (!createdPath) throw new Error("Photoshop 未返回新建工作路径。");
  return createdPath;
}

export async function removeEditableWorkPath(path: PhotoshopPathItem, documentId: number): Promise<void> {
  await core.executeAsModal(async () => {
    assertDocument(documentId);
    const document = app.activeDocument as unknown as { pathItems: PhotoshopPathItems };
    const current = Array.from(
      { length: document.pathItems.length },
      (_, index) => document.pathItems[index]
    ).find((candidate) => Boolean(
      candidate && (
        (path.id !== undefined && candidate.id === path.id)
        || candidate.name === path.name
      )
    ));
    if (!current) return;
    if (typeof current.remove === "function") {
      await current.remove();
      return;
    }
    const target = Number.isFinite(current.id)
      ? { _ref: "path", _id: current.id }
      : { _ref: "path", _name: current.name };
    const [response] = await action.batchPlay([{
      _obj: "delete",
      _target: [target],
      _options: { dialogOptions: "dontDisplay" }
    }], {});
    const result = response as unknown as { _obj?: string; message?: string } | undefined;
    if (result?._obj === "error") {
      throw new Error(result.message || `无法清理中间工作路径“${current.name}”。`);
    }
  }, { commandName: "AI勾线 · 清理工作路径" });
}

export async function deselectEditableWorkPath(documentId: number): Promise<void> {
  await core.executeAsModal(async () => {
    assertDocument(documentId);
    await deselectPathUiInsideModal();
  }, { commandName: "AI勾线 · 隐藏路径锚点与手柄" });
}

export async function convertSelectedPathToShapeLayer(
  strokeWidth: number,
  layerName: string,
  documentId: number,
  sourceLayerId?: number
): Promise<PhotoshopPathItem> {
  const descriptor = {
    _obj: "make",
    _target: [{ _ref: "contentLayer" }],
    using: {
      _obj: "contentLayer",
      type: {
        _obj: "solidColorLayer",
        color: { _obj: "RGBColor", red: 0, green: 0, blue: 0 }
      },
      strokeStyle: {
        _obj: "strokeStyle",
        strokeStyleVersion: 2,
        strokeEnabled: true,
        fillEnabled: false,
        strokeStyleLineWidth: { _unit: "pixelsUnit", _value: strokeWidth },
        strokeStyleLineDashOffset: { _unit: "pointsUnit", _value: 0 },
        strokeStyleMiterLimit: 100,
        strokeStyleLineCapType: {
          _enum: "strokeStyleLineCapType",
          _value: "strokeStyleRoundCap"
        },
        strokeStyleLineJoinType: {
          _enum: "strokeStyleLineJoinType",
          _value: "strokeStyleRoundJoin"
        },
        strokeStyleLineAlignment: {
          _enum: "strokeStyleLineAlignment",
          _value: "strokeStyleAlignCenter"
        },
        strokeStyleScaleLock: false,
        strokeStyleStrokeAdjust: false,
        strokeStyleLineDashSet: [],
        strokeStyleBlendMode: { _enum: "blendMode", _value: "normal" },
        strokeStyleOpacity: { _unit: "percentUnit", _value: 100 },
        strokeStyleContent: {
          _obj: "solidColorLayer",
          color: { _obj: "RGBColor", red: 0, green: 0, blue: 0 }
        },
        strokeStyleResolution: Number(app.activeDocument.resolution || 72)
      }
    },
    _options: { dialogOptions: "dontDisplay" }
  };
  let createdLayer: PhotoshopPathItem | null = null;
  await core.executeAsModal(async () => {
    assertDocument(documentId);
    await action.batchPlay([descriptor], {});
    const layer = app.activeDocument.activeLayers?.[0];
    if (!layer) throw new Error("Photoshop 创建描边 Shape 后没有返回图层。");
    layer.name = layerName;
    if (sourceLayerId !== undefined) {
      await alignResultToSource(
        app.activeDocument as unknown as Parameters<typeof alignResultToSource>[0],
        layer.id,
        sourceLayerId,
        undefined,
        { fit: "preserve", moveAbove: true }
      );
    }
    createdLayer = { id: layer.id, name: layer.name };
  }, { commandName: "AI勾线 · 创建描边 Shape 层" });
  if (!createdLayer) throw new Error("Photoshop 未返回描边 Shape 图层。");
  return createdLayer;
}

export type { PhotoshopPathItem };
