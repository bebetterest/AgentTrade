import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CliValidationError } from "../src/errors.js";
import { resolveFileBackedInput, resolveTextInput } from "../src/text-input.js";
import {
  ensureActivityType,
  ensureAddress,
  ensureAgentListSort,
  ensureDisputeListSort,
  ensureDisputeStatus,
  ensureEip191Signature,
  ensureHttpUrl,
  ensureIanaTimeZone,
  ensureIsoDate,
  ensureMaxLength,
  ensureNonEmpty,
  ensureNonNegativeInteger,
  ensureOverrideResult,
  ensurePageLimit,
  ensurePrivateKey,
  ensurePositiveInteger,
  ensureQueryOrder,
  ensureSubmissionListSort,
  ensureSubmissionStatus,
  ensureTaskListSort,
  ensureTaskStatus,
  ensureTrimmedNonEmptyMaxLength,
  ensureTrendWindow,
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
  assert.equal(ensurePageLimit("100", "--limit"), 100);
  assert.equal(ensureNonNegativeInteger("0", "--retries"), 0);
  assert.throws(() => ensurePositiveInteger("0", "--slots"), CliValidationError);
  assert.throws(() => ensurePageLimit("101", "--limit"), CliValidationError);
  assert.throws(() => ensureNonNegativeInteger("-1", "--retries"), CliValidationError);
  assert.throws(() => ensurePositiveInteger("1.2", "--slots"), CliValidationError);
  assert.throws(() => ensurePositiveInteger(String(Number.MAX_SAFE_INTEGER + 1), "--slots"), CliValidationError);

  assert.equal(
    ensurePrivateKey("0x1111111111111111111111111111111111111111111111111111111111111111", "--private-key"),
    "0x1111111111111111111111111111111111111111111111111111111111111111"
  );
  assert.throws(() => ensurePrivateKey("0x1234", "--private-key"), CliValidationError);

  assert.equal(ensureEip191Signature(`0x${"11".repeat(65)}`, "--signature"), `0x${"11".repeat(65)}`);
  assert.throws(() => ensureEip191Signature("0x1234", "--signature"), CliValidationError);
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
  assert.equal(ensureTaskStatus("open"), "OPEN");
  assert.equal(ensureSubmissionStatus("confirmed"), "CONFIRMED");
  assert.equal(ensureDisputeStatus("resolved_completed"), "RESOLVED_COMPLETED");
  assert.equal(ensureTaskListSort("deadline"), "deadline");
  assert.equal(ensureSubmissionListSort("latest"), "latest");
  assert.equal(ensureDisputeListSort("created"), "created");
  assert.equal(ensureAgentListSort("score"), "score");
  assert.equal(ensureQueryOrder("DESC"), "desc");
  assert.equal(ensureTrendWindow("30D"), "30d");
  assert.equal(ensureActivityType("admin_audit"), "ADMIN_AUDIT");
  assert.throws(() => ensureVoteChoice("bad"), CliValidationError);
  assert.throws(() => ensureOverrideResult("bad"), CliValidationError);
  assert.throws(() => ensureTaskStatus("bad"), CliValidationError);
  assert.throws(() => ensureQueryOrder("sideways"), CliValidationError);
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
  assert.equal(ensureMaxLength("ok", 2, "--name"), "ok");
  assert.throws(() => ensureMaxLength("toolong", 3, "--name"), CliValidationError);
  assert.equal(ensureTrimmedNonEmptyMaxLength("  ok  ", 10, "--reason"), "ok");
  assert.throws(() => ensureTrimmedNonEmptyMaxLength("   ", 10, "--reason"), CliValidationError);
  assert.throws(() => ensureTrimmedNonEmptyMaxLength("x".repeat(1001), 1000, "--reason"), CliValidationError);
});

test("text input: inline/file mutual exclusion and file loading", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "agentrade-cli-test-"));
  const filePath = join(tmpDir, "content.md");
  writeFileSync(filePath, "\uFEFFfrom-file", "utf8");

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

test("file-backed input: custom inline/file flag pairs are supported", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "agentrade-cli-test-"));
  const filePath = join(tmpDir, "token.txt");
  writeFileSync(filePath, "\uFEFFtoken-from-file\n", "utf8");

  assert.equal(
    resolveFileBackedInput({
      filePath,
      inlineFlag: "token",
      fileFlag: "token-file",
      required: false,
      normalize: (value) => value.replace(/^\uFEFF/, "").trim()
    }),
    "token-from-file"
  );

  assert.throws(
    () =>
      resolveFileBackedInput({
        inlineValue: "inline-token",
        filePath,
        inlineFlag: "token",
        fileFlag: "token-file",
        required: false
      }),
    CliValidationError
  );
});

test("file-backed input: empty file errors point to the file flag", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "agentrade-cli-test-"));
  const filePath = join(tmpDir, "token-empty.txt");
  writeFileSync(filePath, " \n", "utf8");

  assert.throws(
    () =>
      resolveFileBackedInput({
        filePath,
        inlineFlag: "token",
        fileFlag: "token-file"
      }),
    /--token-file must be non-empty/
  );
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
