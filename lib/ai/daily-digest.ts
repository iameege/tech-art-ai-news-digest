/**
 * Daily Digest Generator - Prompt B Integration
 *
 * Generates a structured daily summary from raw news items.
 * Uses the "LENS — Think Like a Futurist" prompt framework.
 */

import { runLlm } from "./llm";
import { extractJson } from "./json-util";
import { jsonrepair } from "jsonrepair";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface DigestOutput {
  narrative: string;           // 今日叙事 (C)
  crossDiscovery: string[];    // 跨领域发现
  importanceHigh: string[];    // 高影响力
  importanceMedium: string[];  // 值得关注
  importanceLow: string[];     // 信息速览
  domainAI: string;            // AI与技术
  domainGame: string;          // 游戏与引擎
  domainArt: string;           // 美术与工具
  domainResearch: string;      // 学术前沿
}

const SYSTEM_PROMPT_DIGEST_B = `You are a Technical Artist (技术美术) working in game development.
Your focus: materials, shaders, VFX (Niagara), procedural content (PCG), DCC tools, and workflow optimization.

技术美术关注领域：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
核心关注：
- Unreal Engine (Niagara, PCG, 材质系统, 渲染管线, MetaSound)
- DCC 工具 (Blender, Houdini, Maya 工作流, 插件)
- 3D 生成 (Tripo, Hunyuan, Gaussian Splatting, NeRF, AI生成资产)
- 着色器/图形学 (GPU优化, 实时渲染, 性能)
- 游戏技术 (GDC技术演讲, 工具链, 工作流)

相关关注：
- AI工具对技术美术工作流的影响 (如AI生成贴图/模型/动画)
- 跨领域技术溢出 (机器人仿真→游戏, 电影管线→实时渲染)

不关注：
- 纯金融/投资/资本市场
- 政策法规/诉讼
- 企业并购/人事变动
- 纯研究论文(无落地路径)

重要性评分：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. CRITICAL — 直接影响技术美术工作流或工具链
   例：UE5新材质系统、Niagara重大更新、Blender关键插件
2. HIGH — 新工具/技术值得尝试
   例：新3D生成工具、性能优化方案、GDC技术分享
3. MEDIUM — 保持关注，未来可能有用
   例：研究进展、行业趋势
4. SKIP — 与技术美术无关的内容

输出规则：
- 只输出与技术美术相关的新闻
- 跨领域发现要具体说明对技术美术的价值
- 用技术美术的视角解释"为什么重要"
- 读者标记的文章/主题必须出现在摘要中，优先级最高，不可跳过
- 每条提及的新闻附上编号(n)，方便读者回查
- domain字段之间避免重复同一内容，突出不同角度

OUTPUT FORMAT (JSON ONLY):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "narrative": "今天对技术美术最重要的信号是X，因为[对工作流/工具链的影响]",
  "crossDiscovery": ["发现：X领域 → 技术美术应用，具体价值", ...],
  "importanceHigh": ["#编号 CRITICAL项 — 技术美术视角的一句话", ...],
  "importanceMedium": ["#编号 HIGH项 — 技术美术视角的一句话", ...],
  "importanceLow": ["#编号 MEDIUM项 — 技术美术视角的一句话", ...],
  "domainAI": "AI工具对技术美术的影响",
  "domainGame": "引擎/渲染/性能相关",
  "domainArt": "DCC工具/资产生成相关",
  "domainResearch": "研究→技术美术落地路径"
}

Rules:
- All strings in Chinese
- narrative: 从技术美术视角解释
- crossDiscovery: 必须说明对技术美术的价值
- 只输出技术美术相关内容，无关内容跳过
- No markdown, no code fences, just raw JSON`;

interface NewsItem {
  title: string;
  url: string;
  source: string;
  category: string;
  excerpt?: string;
  summary?: string;
}

export async function generateDailyDigest(
  articles: NewsItem[],
): Promise<DigestOutput> {
  // Read likes.md to inject user preferences into the prompt
  let likesContext = "";
  let longTermContext = "";

  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const likesPath = path.resolve(__dirname, "../../likes.md");
    if (fs.existsSync(likesPath)) {
      const likesContent = fs.readFileSync(likesPath, "utf8");
      const lines = likesContent.split("\n");

      // 1. Parse "长期关注方向" section (long-term focus areas)
      let inLongTermSection = false;
      const longTermAreas: string[] = [];
      for (const line of lines) {
        if (line.includes("长期关注方向")) {
          inLongTermSection = true;
          continue;
        }
        if (inLongTermSection && line.startsWith("## ")) {
          break; // End of section
        }
        if (inLongTermSection && line.startsWith("### ")) {
          // Extract: "### 1. #AI工具化 — 最高优先级" → "#AI工具化"
          const area = line.replace(/^###\s+\d+\.\s*/, "").replace(/\s+—.*$/, "").trim();
          if (area) longTermAreas.push(area);
        }
      }
      if (longTermAreas.length > 0) {
        longTermContext = `\n\n读者长期关注方向（稳定兴趣，按优先级排序）：\n${longTermAreas.map((a, i) => `${i + 1}. ${a}`).join("\n")}`;
      }

      // 2. Parse ★ lines (recent bookmarks)
      // Replace "TA" with "技术美术" to avoid LLM interpreting
      // "TA" as "他/她" (relationship content) in Chinese context
      const likes = lines
        .filter((line: string) => line.includes("★"))
        .map((line: string) => line.trim().replace(/\bTA\b/g, "技术美术"))
        .join("\n");
      if (likes) {
        likesContext = `\n\n读者近期关注的主题（最高优先级，匹配的文章必须出现在摘要中）：\n${likes}`;
      }
    }
  } catch {
    // Non-fatal — likes.md is optional
  }

  // Combine long-term and recent context
  const preferenceContext = longTermContext + likesContext;

  // Prepare compact input for LLM
  // Boost articles that match likes.md keywords to the front,
  // so they survive the truncation and get summarized.
  // Priority: recent bookmarks (★) > long-term focus areas
  const boostKeywords: string[] = [];

  // From recent bookmarks (★ lines)
  if (likesContext) {
    const recentKeywords = likesContext
      .split("\n")
      .filter((l) => l.includes("★"))
      .map((l) => l.replace(/-?\s*★\s*/, "").split("—")[0].trim().replace(/^["']|["']$/g, "").split("`")[0].trim())
      .filter((k) => k.length > 3);
    boostKeywords.push(...recentKeywords);
  }

  // From long-term focus areas (#tags)
  if (longTermContext) {
    const longTermKeywords = longTermContext
      .split("\n")
      .filter((l) => l.match(/^\d+\.\s+#/))
      .map((l) => l.replace(/^\d+\.\s+/, "").trim())
      .filter((k) => k.length > 3);
    boostKeywords.push(...longTermKeywords);
  }

  // Hardcoded boost for embodied AI + simulation cross-domain
  // These keywords ensure relevant articles survive truncation and
  // appear in the digest even when likes.md doesn't mention them.
  const EMBODIED_BOOST = [
    "embodied", "具身智能", "robotics", "机器人",
    "simulation", "仿真", "sim-to-real", "Isaac Sim",
    "Cosmos", "world model", "世界模型", "物理AI",
  ];
  boostKeywords.push(...EMBODIED_BOOST);

  const boosted = [...articles].sort((a, b) => {
    const aMatch = boostKeywords.some((k) => a.title.toLowerCase().includes(k.toLowerCase())) ? -1 : 0;
    const bMatch = boostKeywords.some((k) => b.title.toLowerCase().includes(k.toLowerCase())) ? -1 : 0;
    return aMatch - bMatch;
  });

  const newsList = boosted
    .slice(0, 300) // Safety cap — 300 articles ≈ 36k tokens, well within context
    .map((a, i) => ({
      n: i + 1,
      title: a.title,
      source: a.source,
      category: a.category,
      // Use Chinese summary when available (from enrichment), otherwise excerpt
      content: (a.summary ?? a.excerpt ?? "").slice(0, 200),
    }));

  const preferenceInstruction = preferenceContext
    ? `\n\n重要规则：
1. "读者长期关注方向"中的主题如果出现在今日新闻中，优先级较高，应在摘要中体现
2. "读者近期关注的主题"中的文章如果出现在今日新闻中，必须在摘要中体现（至少放入importanceHigh或跨领域发现），不可遗漏`
    : "";

  const userPrompt = `今日新闻条目（共 ${newsList.length} 条）：

${JSON.stringify(newsList, null, 2)}
${preferenceContext}${preferenceInstruction}
请根据上述新闻，生成今日摘要JSON。`;

  const { text } = await runLlm({
    systemPrompt: SYSTEM_PROMPT_DIGEST_B,
    userPrompt,
    timeoutMs: 180_000, // 3 minutes — long JSON generation may need extra time
  });

  // Parse JSON from response (using extractJson + jsonrepair fallback,
  // same robust pattern as enrich.ts)
  const cleaned = extractJson(text);

  let parsed: Partial<DigestOutput>;
  try {
    parsed = JSON.parse(cleaned) as Partial<DigestOutput>;
  } catch {
    try {
      parsed = JSON.parse(jsonrepair(cleaned)) as Partial<DigestOutput>;
      console.warn("[daily-digest] JSON.parse failed but jsonrepair recovered");
    } catch {
      throw new Error("Failed to parse JSON from LLM response (even after jsonrepair)");
    }
  }

  // Return with defaults for missing fields
  return {
    narrative: parsed.narrative ?? "今日暂无重要信号。",
    crossDiscovery: parsed.crossDiscovery ?? [],
    importanceHigh: parsed.importanceHigh ?? [],
    importanceMedium: parsed.importanceMedium ?? [],
    importanceLow: parsed.importanceLow ?? [],
    domainAI: parsed.domainAI ?? "",
    domainGame: parsed.domainGame ?? "",
    domainArt: parsed.domainArt ?? "",
    domainResearch: parsed.domainResearch ?? "",
  };
}
