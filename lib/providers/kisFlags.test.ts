import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isKisApiEnabled } from "./kisFlags";

describe("isKisApiEnabled", () => {
  it("키만 있고 KIS_ENABLED 없으면 OFF", () => {
    assert.equal(isKisApiEnabled({}), false);
    assert.equal(
      isKisApiEnabled({ KIS_APP_KEY: "a", KIS_APP_SECRET: "b" }),
      false
    );
  });

  it("KIS_ENABLED=1 이고 키 있으면 ON", () => {
    assert.equal(
      isKisApiEnabled({
        KIS_APP_KEY: "a",
        KIS_APP_SECRET: "b",
        KIS_ENABLED: "1",
      }),
      true
    );
    assert.equal(
      isKisApiEnabled({
        KIS_APP_KEY: "a",
        KIS_APP_SECRET: "b",
        KIS_ENABLED: "true",
      }),
      true
    );
  });

  it("KIS_DISABLED=1 이면 ENABLED 여도 OFF", () => {
    assert.equal(
      isKisApiEnabled({
        KIS_APP_KEY: "a",
        KIS_APP_SECRET: "b",
        KIS_ENABLED: "1",
        KIS_DISABLED: "1",
      }),
      false
    );
  });

  it("KIS_ENABLED=0 이면 OFF", () => {
    assert.equal(
      isKisApiEnabled({
        KIS_APP_KEY: "a",
        KIS_APP_SECRET: "b",
        KIS_ENABLED: "0",
      }),
      false
    );
  });

  it("공백만 있는 키는 OFF", () => {
    assert.equal(
      isKisApiEnabled({
        KIS_APP_KEY: "  ",
        KIS_APP_SECRET: "b",
        KIS_ENABLED: "1",
      }),
      false
    );
  });
});
