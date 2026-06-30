# 闃呰鍑洪绯荤粺鏋舵瀯閲嶆瀯璁捐

## Overview

灏嗙幇鏈夌殑 Smart Worksheet Generator锛圗lectron + React 闃呰鐞嗚В worksheet 鐢熸垚鍣級鎸?VocabForge AI 鐨勬灦鏋勬ā寮忚繘琛岄噸鏋勶紝淇濈暀鏍稿績闃呰鍑洪閫昏緫锛屽寮?API 閰嶇疆绠＄悊銆侀鐩川閲忔牎楠屻€佹湰鍦版寔涔呭寲涓夊ぇ鑳藉姏銆?
## Goals

1. **澶?Provider API 绠＄悊**锛氭寜 provider 鐙珛瀛樺偍閰嶇疆锛屾敮鎸?custom OpenAI-compatible 鎺ュ彛锛屽甫杩炴帴娴嬭瘯
2. **棰樼洰鏍囧噯鏍￠獙**锛氬唴缃鍒欏紩鎿庡拰鑷姩淇锛岄槻姝?AI 杈撳嚭鍋忕瑙勮寖
3. **闅惧害鍒嗙骇鎺у埗**锛氫繚鐣欑幇鏈?A2/B1/B2/C1 浣撶郴锛屽湪 prompt 鍜屾牎楠屽眰缁嗗寲鍖哄垎
4. **鏈湴椤圭洰瀛樻。**锛氬熀浜?Electron 鏂囦欢绯荤粺 API锛孭roject 绮掑害鎸佷箙鍖栵紙鏂囩珷 + 澶氬娴嬭瘯鍗凤級

## Architecture

淇濈暀鐜版湁鎶€鏈爤锛?*Electron 35 + Vite 6 + React 19 + TypeScript + Tailwind CSS**銆?
鍦?Renderer 杩涚▼鏂板鍥涗釜鏍稿績鏈嶅姟灞傦細

| 鏈嶅姟 | 鑱岃矗 |
|------|------|
| `configService` | 澶?Provider API 閰嶇疆绠＄悊锛堣/鍐?鍒囨崲/楠岃瘉锛?|
| `aiService` | 淇濈暀鐜版湁鐢熸垚閫昏緫锛岄厤缃潵婧愭敼涓?`configService` |
| `validatorService` | 瀵?AI 杩斿洖鐨?`WorksheetData` 鎵ц缁撴瀯鍜岃鍒欐牎楠?|
| `storageService` | 閫氳繃 IPC 璋冪敤 Main 杩涚▼ `fs` API锛岀鐞嗘湰鍦伴」鐩枃浠?|

Electron Main 杩涚▼鏂板 IPC 閫氶亾锛歚fs:read`, `fs:write`, `fs:list`, `fs:delete`锛屽湪 `userData/documents/` 鐩綍涓嬫搷浣?JSON 椤圭洰鏂囦欢銆?
### 鏁版嵁娴?
1. 鐢ㄦ埛绮樿创鏂囩珷 鈫?閫夋嫨闅惧害 鈫?鐐瑰嚮鐢熸垚
2. `aiService` 浠?`configService` 鍙栧綋鍓?provider 閰嶇疆 鈫?鎷兼帴 prompt 鈫?閫氳繃 IPC proxy 璋冪敤 AI
3. AI 杩斿洖 JSON 鈫?`validatorService` 鎵ц缁撴瀯 + 瑙勫垯鏍￠獙
4. 鏍￠獙缁撴灉锛?   - **閫氳繃**锛氬啓鍏?`_meta.validated = true`锛屾覆鏌撶紪杈戝櫒锛岃嚜鍔ㄤ繚瀛樺埌褰撳墠 Project
   - **鏈€氳繃**锛氬脊绐楀垪鍑哄叿浣撻棶棰橈紝鎻愪緵"閲嶆柊鐢熸垚"鎴?寮哄埗浣跨敤"
5. 鐢ㄦ埛缂栬緫/瀵煎嚭鏃讹紝`storageService` 鑷姩鍐欏洖鏈湴 JSON

## Data Model

### AIConfig锛堝寮猴級

```ts
type AIProvider = 'deepseek' | 'kimi' | 'custom';

interface AIConfig {
  provider: AIProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;      // custom provider 蹇呭～
  enabled: boolean;
}
```

### ProviderConfigs锛坙ocalStorage 瀛樺偍缁撴瀯锛?
```ts
interface ProviderConfigs {
  activeProvider: AIProvider;
  providers: Record<AIProvider, AIConfig>;
}
```

瀛樺偍閿悕锛歚vocabforge_ai_keys`銆傛瘡涓?provider 鐙珛淇濆瓨锛屽垏鎹㈡椂涓嶄涪澶卞凡濉殑 key銆?
### Project锛堟湰鍦板瓨妗ｅ崟鍏冿級

```ts
interface Project {
  id: string;            // uuid
  title: string;
  articleText: string;   // 瀹屾暣鍘熷鏂囩珷
  difficulty: Difficulty;
  createdAt: number;
  updatedAt: number;
  worksheets: WorksheetData[];
}
```

### WorksheetData锛堜繚鐣欑幇鏈夌粨鏋勶紝澧炲姞鍏冩暟鎹級

```ts
interface WorksheetData {
  title: string;
  articleSnippet: string;
  summary: { paragraph: string; blanks: string[] };
  multipleChoice: MCQuestion[];
  syntaxDeconstruction: SyntaxDeconstructionItem[];
  writingWorkshop: WritingWorkshop;
  keys: Keys;
  _meta?: {
    generatedAt: number;
    provider: AIProvider;
    model: string;
    validated: boolean;
    validationIssues: string[];
  };
}
```

鐜版湁瀛愮被鍨嬶紙`MCQuestion`, `SyntaxDeconstructionItem`, `ExpansionItem`, `Keys` 绛夛級鍏ㄩ儴淇濈暀锛屼笉鍋氱牬鍧忔€т慨鏀广€?
## API Configuration System

### configService API

```ts
getActiveProvider(): AIProvider
getActiveConfig(): AIConfig
getAllConfigs(): Record<AIProvider, AIConfig>
setProviderConfig(provider: AIProvider, config: AIConfig): void
setActiveProvider(provider: AIProvider): void
validateConfig(config: AIConfig): { valid: boolean; error?: string }
testConnection(config: AIConfig): Promise<{ success: boolean; error?: string }>
```

### UI 閰嶇疆闈㈡澘

鏇挎崲鐜版湁 sidebar 涓殑绠€鍗曚笁瀛楁琛ㄥ崟锛屾敼涓猴細

- Provider dropdown: DeepSeek / Kimi / Custom. Switching providers loads the saved config and model list for that provider.
- API Key input. Custom provider also shows Base URL input. Test Connection sends a minimal OpenAI-compatible completion request. Save Config writes to localStorage.

### Main 杩涚▼ Proxy 澧炲己

淇濈暀鐜版湁 `api-call` IPC锛屽鍔狅細
- Custom provider 鐨?`baseUrl` 鍚堟硶鎬ф牎楠岋紙蹇呴』浠?`http(s)://` 寮€澶达級
- 寮€鍙戞ā寮忎笅鍙€夎姹傛棩蹇?
鎵€鏈?OpenAI-compatible provider锛圖eepSeek / Kimi / Custom锛夊叡鐢ㄥ悓涓€濂?`callOpenAICompatible` 璋冪敤閫昏緫锛宍baseUrl` 鐢?`PROVIDER_BASE_URLS` 鎴栫敤鎴疯嚜瀹氫箟鎻愪緵銆?
## Question Validation System

### 鏍稿績璁捐

```ts
interface ValidationIssue {
  type: 'structure' | 'rule' | 'reference';
  section: 'summary' | 'mc' | 'syntax' | 'writing' | 'keys' | 'global';
  severity: 'error' | 'warning';
  message: string;
  suggestion?: string;
}

interface ValidationResult {
  valid: boolean;          // error 鏁颁负 0 鏃?true
  issues: ValidationIssue[];
  autoFixed: boolean;
  data: WorksheetData;     // 缁忚嚜鍔ㄤ慨姝ｅ悗鐨勬暟鎹?}
```

鍏ュ彛锛?```ts
validateWorksheet(data: WorksheetData, articleText: string): ValidationResult
```

### 鏍￠獙瑙勫垯锛堟寜棰樺瀷锛?
**Global**
- `title` 闈炵┖
- `articleSnippet` 闈炵┖
- `keys` 瀛樺湪涓斿瓧娈靛畬鏁?
**Summary Completion**
- `[BLANK]` 鍑虹幇娆℃暟 === `blanks` 闀垮害 === `keys.summary` 闀垮害
- 姣忎釜绛旀鍦?`articleText` 涓彲鎵惧埌锛堝厑璁稿ぇ灏忓啓/鏍囩偣宸紓锛?- 姣忎釜绛旀璇嶆暟 鈮?3

**Multiple Choice**
- 鎬婚鏁?=== 10
- 姣忛鎭板ソ 4 涓€夐」
- 棰樺瀷鍒嗗竷锛歚Finding Evidence` 鎭板ソ 2 閬擄紱`Vocabulary in Context` 鈮?1 閬?- 閫夐」涓嶈兘甯?`A.`/`B.`/`1.` 绛夊墠缂€ 鈫?**鑷姩淇**
- `answer` 蹇呴』鏄?`options` 涔嬩竴 鈫?**鑷姩淇锛堟ā绯婂尮閰嶏級**
- `answer` 鍊煎簲涓哄瓧姣?A/B/C/D 鈫?**鑷姩淇锛堥€夐」鏂囨湰杞瓧姣嶏級**
- 绛旀鍧囧寑鍒嗗竷 A/B/C/D锛堝悇 2-3 涓級鈫?**warning**
- 閫夐」闀垮害宸紓涓嶈秴杩?50% 鈫?**warning**
- `explanation` 闈炵┖

**Syntax Deconstruction**
- 鎭板ソ 2 棰?- `original` 鍦?`articleText` 涓浉浼煎害 > 80%
- `answer` 闈炵┖

**Writing Workshop**
- Expansion锛氭伆濂?4 棰橈紝`conjunctions` 姣忛鑷冲皯 1 涓?- Keywords锛氭伆濂?5 涓紝姣忚瘝鍦?`articleText` 涓嚭鐜?- Q&A锛氭伆濂?4 棰?- Critical Thinking锛氶潪绌哄瓧绗︿覆

**Keys**
- 鍚?section key 鏁伴噺涓庡搴旈鐩暟閲忎竴鑷?
### 鑷姩淇绛栫暐

| 闂 | 淇鏂瑰紡 |
|------|----------|
| 閫夐」甯﹀墠缂€ | 姝ｅ垯鍘婚櫎 `A.`/`B)`/`1.` 绛?|
| MC answer 鏄€夐」鏂囨湰 | 鍖归厤绱㈠紩杞?A/B/C/D |
| summary blanks/keys 闀垮害涓嶄竴鑷翠絾 paragraph 鍖归厤 | 浠?paragraph 涓哄噯閲嶆柊瀵归綈 |

鏃犳硶鑷姩淇鐨勶紙棰樻暟涓嶅銆佺瓟妗堝垎甯冧笉鍧囩瓑锛変綔涓?error/warning 灞曠ず銆?
### 鏍囧噯鑼冧緥

鍐呯疆涓ゅ hand-crafted 鑼冧緥 JSON 浜?`src/data/standard-examples/`锛?- `example-b2-sat.json`
- `example-c1-ielts.json`

鐢ㄩ€旓細缁撴瀯鍙傜収銆佽鍒欓槇鍊兼牎鍑嗭紙濡傞€夐」闀垮害宸紓 50% 涓虹粡楠屽€硷級銆佹牎楠屽櫒鍗曞厓娴嬭瘯銆?
### UI 鍙嶉

- 鍏ㄩ儴閫氳繃锛氱姸鎬佹爮 鉁?宸叉牎楠?- 鏈?warning锛氱姸鎬佹爮 鈿狅笍 n warnings锛屽彲灞曞紑鏌ョ湅
- 鏈?error锛氭嫤鎴脊绐楋紝鍒楀嚭 error + suggestion锛屾彁渚?閲嶆柊鐢熸垚"/"寮哄埗浣跨敤"

## Local Persistence System

### storageService API

```ts
getProjects(): Promise<ProjectMeta[]>
getProject(id: string): Promise<Project>
saveProject(project: Project): Promise<void>
deleteProject(id: string): Promise<void>
exportProject(project: Project): string        // JSON 瀛楃涓?importProject(json: string): Project
```

### Electron Main 杩涚▼鏂囦欢鎿嶄綔

瀛樺偍鐩綍锛歚app.getPath('userData')/documents/`

- `fs:list`锛氳鍙栫洰褰曚笅鎵€鏈?`.json`锛岃В鏋愪负 `ProjectMeta` 鍒楄〃锛堟寜 `updatedAt` 闄嶅簭锛?- `fs:read(id)`锛氳鍙?`{id}.json`
- `fs:write(project)`锛氬簭鍒楀寲鍐欏叆 `{project.id}.json`
- `fs:delete(id)`锛氬垹闄?`{id}.json`

### 椤圭洰鏂囦欢鏍煎紡

姣忛」鐩竴涓?JSON 鏂囦欢锛歚{uuid}.json`

鍖呭惈瀹屾暣 `Project` 缁撴瀯锛堝惈 `articleText` 鍜?`worksheets` 鏁扮粍锛夈€?
### 鑷姩淇濆瓨绛栫暐

- **棣栨鐢熸垚**锛氭牎楠岄€氳繃鍚庤嚜鍔ㄥ垱寤?Project 骞朵繚瀛?- **缂栬緫鏃?*锛歟ditor 妯″紡涓?debounce 500ms 鑷姩 `saveProject`
- **鍏抽棴鍓?*锛歚beforeunload` flush 鏈繚瀛樻洿鏀?- **鎵嬪姩淇濆瓨**锛歴idebar 鎻愪緵 馃捑 Save 鎸夐挳

### UI 瀛樻。绠＄悊

Sidebar 鏂板 Projects 鍖哄煙锛?- New Project 鎸夐挳
- 椤圭洰鍒楄〃锛堟爣棰?+ 闅惧害 + worksheet 鏁?+ 缂栬緫/鍒犻櫎鎸夐挳锛?- Export All 鎸夐挳锛堝鍑烘墍鏈夐」鐩?JSON 鐨?zip锛?- 鏀寔浠庢枃浠跺鍏ラ」鐩紙鎷栨斁鎴栭€夋嫨鏂囦欢锛?
## File Structure

```
鈹溾攢鈹€ electron/
鈹?  鈹溾攢鈹€ main.ts              # BrowserWindow + IPC (api-call + fs:*)
鈹?  鈹斺攢鈹€ preload.ts           # contextBridge expose (api-call + fs:*)
鈹溾攢鈹€ src/
鈹?  鈹溾攢鈹€ main.tsx             # React 鍏ュ彛
鈹?  鈹溾攢鈹€ App.tsx              # 鍏ㄥ眬鐘舵€?+ 甯冨眬楠ㄦ灦锛堝ぇ骞呯槮韬級
鈹?  鈹溾攢鈹€ types.ts             # 鍏ㄩ儴绫诲瀷瀹氫箟锛堣拷鍔犳柊绫诲瀷锛?鈹?  鈹溾攢鈹€ index.css            # 鍏ㄥ眬鏍峰紡 + 鍔ㄧ敾
鈹?  鈹溾攢鈹€ components/
鈹?  鈹?  鈹溾攢鈹€ InputSection.tsx         # 鏂囩珷杈撳叆銆侀毦搴︺€佺敓鎴愭寜閽?鈹?  鈹?  鈹溾攢鈹€ TestPreview.tsx          # 娴嬭瘯鍗锋覆鏌?缂栬緫锛堝師 WorksheetPaper锛?鈹?  鈹?  鈹溾攢鈹€ SectionTogglePanel.tsx   # 棰樺瀷寮€鍏充笌鎺掑簭
鈹?  鈹?  鈹溾攢鈹€ ConfigPanel.tsx          # AI Provider 閰嶇疆闈㈡澘
鈹?  鈹?  鈹溾攢鈹€ ProjectPanel.tsx         # 椤圭洰鍒楄〃涓庣鐞?鈹?  鈹?  鈹溾攢鈹€ ValidationPanel.tsx      # 鏍￠獙缁撴灉灞曠ず
鈹?  鈹?  鈹斺攢鈹€ EditorSection.tsx        # 閫氱敤鎶樺彔闈㈡澘澹冲瓙
鈹?  鈹溾攢鈹€ services/
鈹?  鈹?  鈹溾攢鈹€ aiService.ts             #  worksheet 鐢熸垚锛堜繚鐣欐牳蹇冮€昏緫锛?鈹?  鈹?  鈹溾攢鈹€ configService.ts         #  Provider 閰嶇疆绠＄悊
鈹?  鈹?  鈹溾攢鈹€ validatorService.ts      #  鏍￠獙鍏ュ彛涓庣紪鎺?鈹?  鈹?  鈹溾攢鈹€ storageService.ts        #  鏈湴鏂囦欢绠＄悊锛圧enderer 渚э級
鈹?  鈹?  鈹斺攢鈹€ deepseekService.ts         #  DeepSeek 涓撶敤娴佸紡鎺ュ彛锛堥鐣欙級
鈹?  鈹溾攢鈹€ validators/
鈹?  鈹?  鈹溾攢鈹€ index.ts                 # 鏍￠獙鍣ㄧ紪鎺?鈹?  鈹?  鈹溾攢鈹€ summaryValidator.ts
鈹?  鈹?  鈹溾攢鈹€ mcValidator.ts
鈹?  鈹?  鈹溾攢鈹€ syntaxValidator.ts
鈹?  鈹?  鈹溾攢鈹€ writingValidator.ts
鈹?  鈹?  鈹斺攢鈹€ keysValidator.ts
鈹?  鈹溾攢鈹€ data/
鈹?  鈹?  鈹斺攢鈹€ standard-examples/
鈹?  鈹?      鈹溾攢鈹€ example-b2-sat.json
鈹?  鈹?      鈹斺攢鈹€ example-c1-ielts.json
鈹?  鈹斺攢鈹€ utils/
鈹?      鈹斺攢鈹€ pdfExport.ts             # PDF 瀵煎嚭棰勭暀
鈹溾攢鈹€ index.html
鈹溾攢鈹€ package.json
鈹溾攢鈹€ tsconfig.json
鈹斺攢鈹€ vite.config.ts
```

## Migration Plan

| 鐜版湁鏂囦欢 | 澶勭悊鏂瑰紡 |
|----------|----------|
| `electron/main.js` | 鏀逛负 `.ts`锛屾柊澧?`fs:*` IPC handlers |
| `electron/preload.js` | 鏀逛负 `.ts`锛屾毚闇?`fs:*` API |
| `App.tsx` | 鐦﹁韩锛氫繚鐣欏叏灞€鐘舵€佷笌甯冨眬锛孶I 閫昏緫鎷嗚嚦 components |
| `services/aiService.ts` | 淇濈暀鐢熸垚閫昏緫锛宍getStoredConfig` 绛夌Щ鑷?`configService` |
| `types.ts` | 杩藉姞 `Project`, `ProviderConfigs`, `ValidationResult` 绛?|
| `components/EditorSection.tsx` | 淇濈暀 |

## Key Decisions

1. **localStorage 鍙瓨閰嶇疆锛岄」鐩暟鎹蛋鏂囦欢绯荤粺**锛氶伩鍏?localStorage 瀹归噺闄愬埗锛屽瓨妗ｆ洿鍙潬
2. **Project 绮掑害 = 鏂囩珷 + 澶氬娴嬭瘯鍗?*锛氭敮鎸佸悓涓€绡囨枃绔犵敓鎴愬涓増鏈垨淇敼鍚庡彟瀛?3. **鏍￠獙鍣ㄦ寜棰樺瀷鎷嗗垎鏂囦欢**锛氳鍒欑嫭绔嬶紝渚夸簬鍗曟祴鍜岀淮鎶?4. **淇濈暀鐜版湁 WorksheetData 缁撴瀯**锛氫笉鐮村潖鐜版湁娓叉煋鍜屽鍑洪€昏緫锛岄檷浣庨噸鏋勯闄?5. **HTML 瀵煎嚭淇濈暀锛孭DF 棰勭暀**锛氬綋鍓?HTML 瀵煎嚭宸叉弧瓒虫墦鍗伴渶姹傦紝jsPDF 鍙綔涓哄悗缁凯浠?
