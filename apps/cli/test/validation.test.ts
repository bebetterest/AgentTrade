import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CliValidationError } from "../src/errors.js";
import { resolveTextInput } from "../src/text-input.js";
import {
  ensureAddress,
  ensureHttpUrl,
  ensureIanaTimeZone,
  ensureIsoDate,
  ensureNonEmpty,
  ensureNonNegativeInteger,
  ensureOverrideResult,
  ensurePositiveInteger,
  ensureVoteChoice,
  parseOptionalAddressList
} from "../src/validators.js";

test("validators: address and integer parsing", () => {
  assert.equal(
    ensureAddress("0x1111111111111111111111111111111111111111", "--address"),
    "0x1111111111111111111111111111111111111111"
  );
  assert.throws(() => ensureAddress("bad", "--address"), CliValidationError);

  assert.equal(ensurePositiveInteger("10", "--slots"), 10);
  assert.equal(ensureNonNegativeInteger("0", "--retries"), 0);
  assert.throws(() => ensurePositiveInteger("0", "--slots"), CliValidationError);
  assert.throws(() => ensureNonNegativeInteger("-1", "--retries"), CliValidationError);
  assert.throws(() => ensurePositiveInteger("1.2", "--slots"), CliValidationError);
  assert.throws(() => ensurePositiveInteger(String(Number.MAX_SAFE_INTEGER + 1), "--slots"), CliValidationError);
});

test("validators: datetime and enum parsing", () => {
  const iso = ensureIsoDate("2027-01-01T00:00:00.000Z", "--deadline");
  assert.equal(iso, "2027-01-01T00:00:00.000Z");
  const fromOffset = ensureIsoDate("2027-01-01T08:00:00+08:00", "--deadline");
  assert.equal(fromOffset, "2027-01-01T00:00:00.000Z");
  assert.throws(() => ensureIsoDate("2027-01-01", "--deadline"), CliValidationError);
  assert.throws(() => ensureIsoDate("not-date", "--deadline"), CliValidationError);

  assert.equal(ensureIanaTimeZone("UTC", "--tz"), "UTC");
  assert.equal(ensureIanaTimeZone("Asia/Shanghai", "--tz"), "Asia/Shanghai");
  assert.throws(() => ensureIanaTimeZone("", "--tz"), CliValidationError);
  assert.throws(() => ensureIanaTimeZone("Mars/Base", "--tz"), CliValidationError);

  assert.equal(ensureVoteChoice("completed"), "COMPLETED");
  assert.equal(ensureOverrideResult("not_completed"), "NOT_COMPLETED");
  assert.throws(() => ensureVoteChoice("bad"), CliValidationError);
  assert.throws(() => ensureOverrideResult("bad"), CliValidationError);
});

test("validators: url parsing", () => {
  assert.equal(ensureHttpUrl("http://localhost:3000", "--base-url"), "http://localhost:3000");
  assert.equal(ensureHttpUrl("https://example.com/api", "--base-url"), "https://example.com/api");
  assert.throws(() => ensureHttpUrl("", "--base-url"), CliValidationError);
  assert.throws(() => ensureHttpUrl("ftp://example.com", "--base-url"), CliValidationError);
  assert.throws(() => ensureHttpUrl("not-a-url", "--base-url"), CliValidationError);
});

test("validators: non-empty string", () => {
  assert.equal(ensureNonEmpty("ok", "--task"), "ok");
  assert.throws(() => ensureNonEmpty("   ", "--task"), CliValidationError);
});

test("text input: inline/file mutual exclusion and file loading", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "agentrade-cli-test-"));
  const filePath = join(tmpDir, "content.md");
  writeFileSync(filePath, "from-file", "utf8");

  assert.equal(
    resolveTextInput({ inlineValue: "inline", fieldName: "payload" }),
    "inline"
  );
  assert.equal(
    resolveTextInput({ filePath, fieldName: "payload" }),
    "from-file"
  );

  assert.throws(
    () =>
      resolveTextInput({
        inlineValue: "inline",
        filePath,
        fieldName: "payload"
      }),
    CliValidationError
  );

  assert.throws(() => resolveTextInput({ fieldName: "payload" }), CliValidationError);
});

test("address list parsing", () => {
  const list = parseOptionalAddressList(
    "0x1111111111111111111111111111111111111111,0x2222222222222222222222222222222222222222",
    "--addresses"
  );
  assert.deepEqual(list, [
    "0x1111111111111111111111111111111111111111",
    "0x2222222222222222222222222222222222222222"
  ]);

  assert.equal(parseOptionalAddressList(undefined, "--addresses"), undefined);
  assert.deepEqual(
    parseOptionalAddressList(
      " 0x1111111111111111111111111111111111111111   0x1111111111111111111111111111111111111111 ",
      "--addresses"
    ),
    ["0x1111111111111111111111111111111111111111"]
  );
  assert.throws(() => parseOptionalAddressList("bad", "--addresses"), CliValidationError);
});
