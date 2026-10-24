import assert from "node:assert/strict";
import { test } from "node:test";
import { GhCliClient } from "../src/publish/client.ts";

test("T00 native publish preflight reads actual repository token permission and owning Issue", async () => {
  const queries: string[] = [];
  const client = new GhCliClient({
    exec: async (_binary, args) => {
      const path = args.at(-1) ?? "";
      queries.push(path);
      if (path === "repos/owner/repo")
        return {
          stdout: JSON.stringify({ full_name: "owner/repo", permissions: { push: true } }),
          stderr: "",
        };
      if (path === "repos/owner/repo/issues/7")
        return {
          stdout: JSON.stringify({
            number: 7,
            locked: false,
            html_url: "https://github.com/owner/repo/issues/7",
          }),
          stderr: "",
        };
      throw Error("unknown GitHub endpoint");
    },
  });
  assert.equal(await client.verifyIssuePublicationPermission("owner/repo", 7), true);
  assert.deepEqual(queries, ["repos/owner/repo", "repos/owner/repo/issues/7"]);
});

test("T00 no write permission, missing Issue, locked Issue or native HTTP error never qualify", async () => {
  const build = (repo: unknown, issue: unknown) =>
    new GhCliClient({
      exec: async (_binary, args) => {
        const path = args.at(-1) ?? "";
        if (path === "repos/owner/repo")
          return {
            stdout: JSON.stringify(repo),
            stderr: "",
          };
        return { stdout: JSON.stringify(issue), stderr: "" };
      },
    });
  const actual = { number: 7, locked: false, html_url: "https://github.com/owner/repo/issues/7" };
  assert.equal(
    await build(
      { full_name: "owner/repo", permissions: { pull: true } },
      actual,
    ).verifyIssuePublicationPermission("owner/repo", 7),
    false,
  );
  assert.equal(
    await build(
      { full_name: "owner/repo", permissions: { push: true } },
      { ...actual, locked: true },
    ).verifyIssuePublicationPermission("owner/repo", 7),
    false,
  );
  assert.equal(
    await build(
      { full_name: "owner/repo", permissions: { push: true } },
      { ...actual, number: 9 },
    ).verifyIssuePublicationPermission("owner/repo", 7),
    false,
  );
  const fail = new GhCliClient({
    exec: async () => {
      throw Error("HTTP 403");
    },
  });
  assert.equal(await fail.verifyIssuePublicationPermission("owner/repo", 7), false);
});
