import { describe, expect, it } from "vitest";
import { escapeCsv, toCsv } from "../src/utils/csv";
import {
  buildBatchOutputNames,
  defaultBatchBaseName,
  defaultTableGridBaseName,
  findOutputNameConflicts,
  sanitizeFileName
} from "../src/utils/fileNames";

describe("output utilities", () => {
  it("cleans cross-platform-invalid file name characters", () => {
    expect(sanitizeFileName('a<b>:c/"d"?* ')).toBe("a_b__c__d___");
  });

  it("escapes CSV values and emits a BOM", () => {
    expect(escapeCsv('a,"b"')).toBe('"a,""b"""');
    expect(toCsv([["名称", "a,b"]])).toBe('\uFEFF名称,"a,b"\r\n');
  });

  it("builds editable multi-volume output names", () => {
    expect(defaultBatchBaseName("M图标月度安排2.xlsx", "巴西第三十二至三十四章"))
      .toBe("M图标月度安排2_巴西第三十二至三十四章");
    expect(defaultTableGridBaseName("M图标月度安排2.xlsx", "巴西第三十二至三十四章"))
      .toBe("M图标月度安排2_巴西第三十二至三十四章_网格");
    expect(buildBatchOutputNames("我的归档", 2)).toEqual([
      {
        volumeNumber: 1,
        psd: "我的归档_01.psd"
      },
      {
        volumeNumber: 2,
        psd: "我的归档_02.psd"
      }
    ]);
  });

  it("detects output conflicts case-insensitively before generation", () => {
    expect(findOutputNameConflicts(
      ["Archive_01.psd", "Archive_02.psd"],
      ["archive_01.PSD", "other.txt"]
    )).toEqual(["Archive_01.psd"]);
  });
});
