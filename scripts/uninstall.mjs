#!/usr/bin/env node
/**
 * Cross-platform uninstaller. Reverses everything install.mjs did:
 *   - Removes scheduled task (Task Scheduler / launchd / crontab)
 *   - Removes user-level skill + commands at ~/.claude/
 *   - Removes ~/.tech-art-ai-news-digest-config
 *
 * Idempotent — safe to run even if pieces don't exist.
 * Does NOT touch project files, daily_reports/, logs/, or power-plan settings.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";

function safeRm(p) {
  if (fs.existsSync(p) || fs.lstatSync(p, { throwIfNoEntry: false })) {
    fs.rmSync(p, { recursive: true, force: true });
    console.log(`[OK] removed ${p}`);
    return true;
  }
  return false;
}

// === 1. Scheduled task ===

if (process.platform === "win32") {
  // Stop + unregister via PowerShell
  const psScript = `
$task = Get-ScheduledTask -TaskName TechArtAINewsDigest -ErrorAction SilentlyContinue
if ($task) {
    try { Stop-ScheduledTask -TaskName TechArtAINewsDigest -ErrorAction SilentlyContinue } catch {}
    Unregister-ScheduledTask -TaskName TechArtAINewsDigest -Confirm:$false
    Write-Host "[OK] Task 'TechArtAINewsDigest' unregistered"
} else {
    Write-Host "[skip] Task 'TechArtAINewsDigest' was not registered"
}
`;
  const tmp = path.join(os.tmpdir(), `tech-art-ai-news-digest-uninstall-${Date.now()}.ps1`);
  fs.writeFileSync(tmp, psScript, "utf8");
  try {
    execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${tmp}"`, {
      stdio: "inherit",
    });
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {}
  }
} else if (process.platform === "darwin") {
  const plistPath = path.join(
    os.homedir(),
    "Library",
    "LaunchAgents",
    "com.tech-art-ai-news-digest.plist",
  );
  if (fs.existsSync(plistPath)) {
    spawnSync("launchctl", ["unload", plistPath], { stdio: "ignore" });
    fs.unlinkSync(plistPath);
    console.log(`[OK] removed launchd job: ${plistPath}`);
  } else {
    console.log("[skip] launchd plist not present");
  }
} else if (process.platform === "linux") {
  const marker = "# tech-art-ai-news-digest";
  const list = spawnSync("crontab", ["-l"], { encoding: "utf8" });
  if (list.status === 0 && list.stdout) {
    const filtered = list.stdout
      .split("\n")
      .filter((line) => !line.includes(marker))
      .join("\n");
    if (filtered === list.stdout) {
      console.log("[skip] no tech-art-ai-news-digest cron entry");
    } else {
      const r = spawnSync("crontab", ["-"], {
        input: filtered.trim() + "\n",
        stdio: ["pipe", "inherit", "inherit"],
      });
      if (r.status === 0) {
        console.log("[OK] removed cron entry");
      }
    }
  } else {
    console.log("[skip] no crontab to clean");
  }
} else {
  console.warn(`Unknown platform ${process.platform}; skipping scheduler cleanup`);
}

// === 2. User-level skill / commands ===

const homeClaude = path.join(os.homedir(), ".claude");
safeRm(path.join(homeClaude, "skills", "tech-art-ai-news-digest"));
safeRm(path.join(homeClaude, "commands", "run-daily.md"));
safeRm(path.join(homeClaude, "commands", "check-daily.md"));

// === 3. Config file ===

safeRm(path.join(os.homedir(), ".tech-art-ai-news-digest-config"));

console.log("\nDone. Project files were NOT touched.");
console.log("Re-install:  node scripts/install.mjs [--global]");
