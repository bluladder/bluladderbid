import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const read = (path) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
const fail = (message) => {
  console.error(`design-governance: FAIL — ${message}`);
  process.exitCode = 1;
};

let governance;
try {
  governance = JSON.parse(read("docs/design-system/governance.json"));
} catch (error) {
  fail(`cannot parse docs/design-system/governance.json: ${error.message}`);
  process.exit();
}

const requiredFiles = [
  "AGENTS.md",
  ".codex/agents/bluladder-product-design-director.toml",
  ".agents/skills/bluladder-product-design-review/SKILL.md",
  ".agents/skills/bluladder-product-design-review/agents/openai.yaml",
  "docs/design-system/README.md",
  "docs/design-system/product-profile.md",
  "docs/design-system/shared-system.md",
];

for (const path of requiredFiles) {
  try {
    read(path);
  } catch {
    fail(`missing required file ${path}`);
  }
}

if (process.exitCode) process.exit();

const agent = read(".codex/agents/bluladder-product-design-director.toml");
const skill = read(".agents/skills/bluladder-product-design-review/SKILL.md");
const metadata = read(".agents/skills/bluladder-product-design-review/agents/openai.yaml");
const profile = read("docs/design-system/product-profile.md");

if (!agent.includes('name = "BluLadder Product Design Director"')) {
  fail("custom agent name is not exact");
}

for (const mode of governance.required_modes ?? []) {
  if (!agent.includes(mode) || !skill.includes(mode)) {
    fail(`mode ${mode} is missing from the agent or Skill`);
  }
}

if (!/^---\nname: bluladder-product-design-review\ndescription: .+\n---\n/s.test(skill)) {
  fail("Skill frontmatter is invalid");
}

if (!metadata.includes("$bluladder-product-design-review")) {
  fail("agents/openai.yaml default_prompt must invoke the Skill");
}

const knownRepositories = Object.values(governance.products ?? {}).map(
  (product) => product.repository,
);
const currentRepository = knownRepositories.find((repository) =>
  profile.includes(`Repository: \`${repository}\``),
);
if (!currentRepository) {
  fail("product profile does not identify a governed repository");
}

const hash = createHash("sha256");
for (const path of [...governance.shared_contract.files].sort()) {
  try {
    hash.update(path);
    hash.update("\0");
    hash.update(read(path));
    hash.update("\0");
  } catch {
    fail(`shared-contract file is missing: ${path}`);
  }
}
const actualHash = hash.digest("hex");

if (process.argv.includes("--print-hash")) {
  console.log(actualHash);
} else if (actualHash !== governance.shared_contract.sha256) {
  fail(
    `shared-contract hash mismatch: expected ${governance.shared_contract.sha256}, got ${actualHash}`,
  );
}

if (!process.exitCode) {
  console.log(
    `design-governance: PASS — ${governance.system_name} ${governance.system_version}; ${currentRepository}; ${governance.shared_contract.files.length} shared files; sha256 ${actualHash}`,
  );
}
