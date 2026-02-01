// ============================================
// Code Knowledge Graph - Cypher Import Script
// Generated: 2026-01-25T16:28:36.175Z
// 
// To use:
// 1. Open Neo4j Browser at http://localhost:7474
// 2. Connect with: bolt://localhost:7687, user: neo4j, password: password
// 3. Paste this entire script and run it
// ============================================

// Clear existing data
MATCH (n) DETACH DELETE n;

// ============================================
// CREATE FILES
// ============================================

CREATE (fapi_agents_orchestrator_js:File {
  path: 'api/agents/orchestrator.js',
  language: 'javascript',
  loc: 272
});

CREATE (fapi_generators_html_generator_js:File {
  path: 'api/generators/html-generator.js',
  language: 'javascript',
  loc: 433
});

CREATE (fapi_generators_style_manager_js:File {
  path: 'api/generators/style-manager.js',
  language: 'javascript',
  loc: 419
});

CREATE (fapi_generators_vision_analyzer_js:File {
  path: 'api/generators/vision-analyzer.js',
  language: 'javascript',
  loc: 274
});

CREATE (fapi_index_js:File {
  path: 'api/index.js',
  language: 'javascript',
  loc: 1154
});

CREATE (fapi_llm_adapter_js:File {
  path: 'api/llm/adapter.js',
  language: 'javascript',
  loc: 105
});

CREATE (fapi_llm_claude_js:File {
  path: 'api/llm/claude.js',
  language: 'javascript',
  loc: 235
});

CREATE (fapi_llm_index_js:File {
  path: 'api/llm/index.js',
  language: 'javascript',
  loc: 122
});

CREATE (fpublic_canvas_html:File {
  path: 'public/canvas.html',
  language: 'html',
  loc: 606
});

CREATE (fpublic_index_html:File {
  path: 'public/index.html',
  language: 'html',
  loc: 607
});

CREATE (fpublic_job_html:File {
  path: 'public/job.html',
  language: 'html',
  loc: 684
});

CREATE (fpublic_paste_html:File {
  path: 'public/paste.html',
  language: 'html',
  loc: 683
});


// ============================================
// CREATE FUNCTIONS
// ============================================

MATCH (fapi_agents_orchestrator_js:File {path: 'api/agents/orchestrator.js'})
CREATE (fnapi_agents_orchestrator_js_createOrchestrator_263:Function {
  id: 'api/agents/orchestrator.js:createOrchestrator:263',
  name: 'createOrchestrator',
  file: 'api/agents/orchestrator.js',
  startLine: 263,
  endLine: 265,
  async: false,
  params: ["config=default"],
  exported: false
})
CREATE (fapi_agents_orchestrator_js)-[:CONTAINS]->(fnapi_agents_orchestrator_js_createOrchestrator_263);

MATCH (fapi_generators_html_generator_js:File {path: 'api/generators/html-generator.js'})
CREATE (fnapi_generators_html_generator_js_escapeHtml_16:Function {
  id: 'api/generators/html-generator.js:escapeHtml:16',
  name: 'escapeHtml',
  file: 'api/generators/html-generator.js',
  startLine: 16,
  endLine: 24,
  async: false,
  params: ["text"],
  exported: false
})
CREATE (fapi_generators_html_generator_js)-[:CONTAINS]->(fnapi_generators_html_generator_js_escapeHtml_16);

MATCH (fapi_generators_html_generator_js:File {path: 'api/generators/html-generator.js'})
CREATE (fnapi_generators_html_generator_js_generateHotspotHTML_32:Function {
  id: 'api/generators/html-generator.js:generateHotspotHTML:32',
  name: 'generateHotspotHTML',
  file: 'api/generators/html-generator.js',
  startLine: 32,
  endLine: 71,
  async: false,
  params: ["hotspot","index"],
  exported: false
})
CREATE (fapi_generators_html_generator_js)-[:CONTAINS]->(fnapi_generators_html_generator_js_generateHotspotHTML_32);

MATCH (fapi_generators_html_generator_js:File {path: 'api/generators/html-generator.js'})
CREATE (fnapi_generators_html_generator_js_generateNoiseRegionHTML_78:Function {
  id: 'api/generators/html-generator.js:generateNoiseRegionHTML:78',
  name: 'generateNoiseRegionHTML',
  file: 'api/generators/html-generator.js',
  startLine: 78,
  endLine: 96,
  async: false,
  params: ["region"],
  exported: false
})
CREATE (fapi_generators_html_generator_js)-[:CONTAINS]->(fnapi_generators_html_generator_js_generateNoiseRegionHTML_78);

MATCH (fapi_generators_html_generator_js:File {path: 'api/generators/html-generator.js'})
CREATE (fnapi_generators_html_generator_js_generateContextBar_104:Function {
  id: 'api/generators/html-generator.js:generateContextBar:104',
  name: 'generateContextBar',
  file: 'api/generators/html-generator.js',
  startLine: 104,
  endLine: 113,
  async: false,
  params: ["manifest","hotspotCount"],
  exported: false
})
CREATE (fapi_generators_html_generator_js)-[:CONTAINS]->(fnapi_generators_html_generator_js_generateContextBar_104);

MATCH (fapi_generators_html_generator_js:File {path: 'api/generators/html-generator.js'})
CREATE (fnapi_generators_html_generator_js_generateClientScript_119:Function {
  id: 'api/generators/html-generator.js:generateClientScript:119',
  name: 'generateClientScript',
  file: 'api/generators/html-generator.js',
  startLine: 119,
  endLine: 215,
  async: false,
  params: [],
  exported: false
})
CREATE (fapi_generators_html_generator_js)-[:CONTAINS]->(fnapi_generators_html_generator_js_generateClientScript_119);

MATCH (fapi_generators_html_generator_js:File {path: 'api/generators/html-generator.js'})
CREATE (fnapi_generators_html_generator_js_generateResearchPanelCSS_221:Function {
  id: 'api/generators/html-generator.js:generateResearchPanelCSS:221',
  name: 'generateResearchPanelCSS',
  file: 'api/generators/html-generator.js',
  startLine: 221,
  endLine: 290,
  async: false,
  params: [],
  exported: false
})
CREATE (fapi_generators_html_generator_js)-[:CONTAINS]->(fnapi_generators_html_generator_js_generateResearchPanelCSS_221);

MATCH (fapi_generators_html_generator_js:File {path: 'api/generators/html-generator.js'})
CREATE (fnapi_generators_html_generator_js_generateHTML_301:Function {
  id: 'api/generators/html-generator.js:generateHTML:301',
  name: 'generateHTML',
  file: 'api/generators/html-generator.js',
  startLine: 301,
  endLine: 343,
  async: false,
  params: ["{...}"],
  exported: false
})
CREATE (fapi_generators_html_generator_js)-[:CONTAINS]->(fnapi_generators_html_generator_js_generateHTML_301);

MATCH (fapi_generators_html_generator_js:File {path: 'api/generators/html-generator.js'})
CREATE (fnapi_generators_html_generator_js_generateHTMLStream_356:Function {
  id: 'api/generators/html-generator.js:generateHTMLStream:356',
  name: 'generateHTMLStream',
  file: 'api/generators/html-generator.js',
  startLine: 356,
  endLine: 415,
  async: true,
  params: ["{...}"],
  exported: false
})
CREATE (fapi_generators_html_generator_js)-[:CONTAINS]->(fnapi_generators_html_generator_js_generateHTMLStream_356);

MATCH (fapi_generators_html_generator_js:File {path: 'api/generators/html-generator.js'})
CREATE (fnapi_generators_html_generator_js_delay_420:Function {
  id: 'api/generators/html-generator.js:delay:420',
  name: 'delay',
  file: 'api/generators/html-generator.js',
  startLine: 420,
  endLine: 422,
  async: false,
  params: ["ms"],
  exported: false
})
CREATE (fapi_generators_html_generator_js)-[:CONTAINS]->(fnapi_generators_html_generator_js_delay_420);

MATCH (fapi_generators_style_manager_js:File {path: 'api/generators/style-manager.js'})
CREATE (fnapi_generators_style_manager_js_analyzeColor_82:Function {
  id: 'api/generators/style-manager.js:analyzeColor:82',
  name: 'analyzeColor',
  file: 'api/generators/style-manager.js',
  startLine: 82,
  endLine: 105,
  async: false,
  params: ["hexColor"],
  exported: false
})
CREATE (fapi_generators_style_manager_js)-[:CONTAINS]->(fnapi_generators_style_manager_js_analyzeColor_82);

MATCH (fapi_generators_style_manager_js:File {path: 'api/generators/style-manager.js'})
CREATE (fnapi_generators_style_manager_js_adjustColor_113:Function {
  id: 'api/generators/style-manager.js:adjustColor:113',
  name: 'adjustColor',
  file: 'api/generators/style-manager.js',
  startLine: 113,
  endLine: 131,
  async: false,
  params: ["hexColor","factor"],
  exported: false
})
CREATE (fapi_generators_style_manager_js)-[:CONTAINS]->(fnapi_generators_style_manager_js_adjustColor_113);

MATCH (fapi_generators_style_manager_js:File {path: 'api/generators/style-manager.js'})
CREATE (fnapi_generators_style_manager_js_adjust_119:Function {
  id: 'api/generators/style-manager.js:adjust:119',
  name: 'adjust',
  file: 'api/generators/style-manager.js',
  startLine: 119,
  endLine: 124,
  async: false,
  params: ["c"],
  exported: false
})
CREATE (fapi_generators_style_manager_js)-[:CONTAINS]->(fnapi_generators_style_manager_js_adjust_119);

MATCH (fapi_generators_style_manager_js:File {path: 'api/generators/style-manager.js'})
CREATE (fnapi_generators_style_manager_js_hexToRgba_139:Function {
  id: 'api/generators/style-manager.js:hexToRgba:139',
  name: 'hexToRgba',
  file: 'api/generators/style-manager.js',
  startLine: 139,
  endLine: 145,
  async: false,
  params: ["hexColor","alpha"],
  exported: false
})
CREATE (fapi_generators_style_manager_js)-[:CONTAINS]->(fnapi_generators_style_manager_js_hexToRgba_139);

MATCH (fapi_generators_style_manager_js:File {path: 'api/generators/style-manager.js'})
CREATE (fnapi_generators_style_manager_js_createStyleManifest_152:Function {
  id: 'api/generators/style-manager.js:createStyleManifest:152',
  name: 'createStyleManifest',
  file: 'api/generators/style-manager.js',
  startLine: 152,
  endLine: 224,
  async: false,
  params: ["analysis"],
  exported: false
})
CREATE (fapi_generators_style_manager_js)-[:CONTAINS]->(fnapi_generators_style_manager_js_createStyleManifest_152);

MATCH (fapi_generators_style_manager_js:File {path: 'api/generators/style-manager.js'})
CREATE (fnapi_generators_style_manager_js_generateCSSString_231:Function {
  id: 'api/generators/style-manager.js:generateCSSString:231',
  name: 'generateCSSString',
  file: 'api/generators/style-manager.js',
  startLine: 231,
  endLine: 237,
  async: false,
  params: ["variables"],
  exported: false
})
CREATE (fapi_generators_style_manager_js)-[:CONTAINS]->(fnapi_generators_style_manager_js_generateCSSString_231);

MATCH (fapi_generators_style_manager_js:File {path: 'api/generators/style-manager.js'})
CREATE (fnapi_generators_style_manager_js_generateBaseCSS_244:Function {
  id: 'api/generators/style-manager.js:generateBaseCSS:244',
  name: 'generateBaseCSS',
  file: 'api/generators/style-manager.js',
  startLine: 244,
  endLine: 408,
  async: false,
  params: ["manifest"],
  exported: false
})
CREATE (fapi_generators_style_manager_js)-[:CONTAINS]->(fnapi_generators_style_manager_js_generateBaseCSS_244);

MATCH (fapi_generators_vision_analyzer_js:File {path: 'api/generators/vision-analyzer.js'})
CREATE (fnapi_generators_vision_analyzer_js_analyzeScreenshot_130:Function {
  id: 'api/generators/vision-analyzer.js:analyzeScreenshot:130',
  name: 'analyzeScreenshot',
  file: 'api/generators/vision-analyzer.js',
  startLine: 130,
  endLine: 144,
  async: true,
  params: ["{...}"],
  exported: false
})
CREATE (fapi_generators_vision_analyzer_js)-[:CONTAINS]->(fnapi_generators_vision_analyzer_js_analyzeScreenshot_130);

MATCH (fapi_generators_vision_analyzer_js:File {path: 'api/generators/vision-analyzer.js'})
CREATE (fnapi_generators_vision_analyzer_js_parseAnalysisFromText_151:Function {
  id: 'api/generators/vision-analyzer.js:parseAnalysisFromText:151',
  name: 'parseAnalysisFromText',
  file: 'api/generators/vision-analyzer.js',
  startLine: 151,
  endLine: 173,
  async: false,
  params: ["text"],
  exported: false
})
CREATE (fapi_generators_vision_analyzer_js)-[:CONTAINS]->(fnapi_generators_vision_analyzer_js_parseAnalysisFromText_151);

MATCH (fapi_generators_vision_analyzer_js:File {path: 'api/generators/vision-analyzer.js'})
CREATE (fnapi_generators_vision_analyzer_js_normalizeAnalysis_180:Function {
  id: 'api/generators/vision-analyzer.js:normalizeAnalysis:180',
  name: 'normalizeAnalysis',
  file: 'api/generators/vision-analyzer.js',
  startLine: 180,
  endLine: 221,
  async: false,
  params: ["analysis"],
  exported: false
})
CREATE (fapi_generators_vision_analyzer_js)-[:CONTAINS]->(fnapi_generators_vision_analyzer_js_normalizeAnalysis_180);

MATCH (fapi_generators_vision_analyzer_js:File {path: 'api/generators/vision-analyzer.js'})
CREATE (fnapi_generators_vision_analyzer_js_normalizeBounds_228:Function {
  id: 'api/generators/vision-analyzer.js:normalizeBounds:228',
  name: 'normalizeBounds',
  file: 'api/generators/vision-analyzer.js',
  startLine: 228,
  endLine: 239,
  async: false,
  params: ["bounds"],
  exported: false
})
CREATE (fapi_generators_vision_analyzer_js)-[:CONTAINS]->(fnapi_generators_vision_analyzer_js_normalizeBounds_228);

MATCH (fapi_generators_vision_analyzer_js:File {path: 'api/generators/vision-analyzer.js'})
CREATE (fnapi_generators_vision_analyzer_js_clamp_244:Function {
  id: 'api/generators/vision-analyzer.js:clamp:244',
  name: 'clamp',
  file: 'api/generators/vision-analyzer.js',
  startLine: 244,
  endLine: 246,
  async: false,
  params: ["value","min","max"],
  exported: false
})
CREATE (fapi_generators_vision_analyzer_js)-[:CONTAINS]->(fnapi_generators_vision_analyzer_js_clamp_244);

MATCH (fapi_generators_vision_analyzer_js:File {path: 'api/generators/vision-analyzer.js'})
CREATE (fnapi_generators_vision_analyzer_js_getInvestigatableHotspots_253:Function {
  id: 'api/generators/vision-analyzer.js:getInvestigatableHotspots:253',
  name: 'getInvestigatableHotspots',
  file: 'api/generators/vision-analyzer.js',
  startLine: 253,
  endLine: 255,
  async: false,
  params: ["analysis"],
  exported: false
})
CREATE (fapi_generators_vision_analyzer_js)-[:CONTAINS]->(fnapi_generators_vision_analyzer_js_getInvestigatableHotspots_253);

MATCH (fapi_generators_vision_analyzer_js:File {path: 'api/generators/vision-analyzer.js'})
CREATE (fnapi_generators_vision_analyzer_js_getTopHotspots_263:Function {
  id: 'api/generators/vision-analyzer.js:getTopHotspots:263',
  name: 'getTopHotspots',
  file: 'api/generators/vision-analyzer.js',
  startLine: 263,
  endLine: 265,
  async: false,
  params: ["analysis","limit=default"],
  exported: false
})
CREATE (fapi_generators_vision_analyzer_js)-[:CONTAINS]->(fnapi_generators_vision_analyzer_js_getTopHotspots_263);

MATCH (fapi_index_js:File {path: 'api/index.js'})
CREATE (fnapi_index_js_getRedis_37:Function {
  id: 'api/index.js:getRedis:37',
  name: 'getRedis',
  file: 'api/index.js',
  startLine: 37,
  endLine: 50,
  async: true,
  params: [],
  exported: false
})
CREATE (fapi_index_js)-[:CONTAINS]->(fnapi_index_js_getRedis_37);

MATCH (fapi_index_js:File {path: 'api/index.js'})
CREATE (fnapi_index_js_storage_setJob_54:Function {
  id: 'api/index.js:storage.setJob:54',
  name: 'storage.setJob',
  file: 'api/index.js',
  startLine: 54,
  endLine: 61,
  async: true,
  params: ["jobId","data","ttl=default"],
  exported: false
})
CREATE (fapi_index_js)-[:CONTAINS]->(fnapi_index_js_storage_setJob_54);

MATCH (fapi_index_js:File {path: 'api/index.js'})
CREATE (fnapi_index_js_storage_getJob_63:Function {
  id: 'api/index.js:storage.getJob:63',
  name: 'storage.getJob',
  file: 'api/index.js',
  startLine: 63,
  endLine: 71,
  async: true,
  params: ["jobId"],
  exported: false
})
CREATE (fapi_index_js)-[:CONTAINS]->(fnapi_index_js_storage_getJob_63);

MATCH (fapi_index_js:File {path: 'api/index.js'})
CREATE (fnapi_index_js_storage_updateJob_73:Function {
  id: 'api/index.js:storage.updateJob:73',
  name: 'storage.updateJob',
  file: 'api/index.js',
  startLine: 73,
  endLine: 81,
  async: true,
  params: ["jobId","updates"],
  exported: false
})
CREATE (fapi_index_js)-[:CONTAINS]->(fnapi_index_js_storage_updateJob_73);

MATCH (fapi_index_js:File {path: 'api/index.js'})
CREATE (fnapi_index_js_getAnthropicClient_100:Function {
  id: 'api/index.js:getAnthropicClient:100',
  name: 'getAnthropicClient',
  file: 'api/index.js',
  startLine: 100,
  endLine: 107,
  async: false,
  params: [],
  exported: false
})
CREATE (fapi_index_js)-[:CONTAINS]->(fnapi_index_js_getAnthropicClient_100);

MATCH (fapi_index_js:File {path: 'api/index.js'})
CREATE (fnapi_index_js_sendEvent_255:Function {
  id: 'api/index.js:sendEvent:255',
  name: 'sendEvent',
  file: 'api/index.js',
  startLine: 255,
  endLine: 259,
  async: false,
  params: ["event","data"],
  exported: false
})
CREATE (fapi_index_js)-[:CONTAINS]->(fnapi_index_js_sendEvent_255);

MATCH (fapi_index_js:File {path: 'api/index.js'})
CREATE (fnapi_index_js_buildAnalysisPrompt_380:Function {
  id: 'api/index.js:buildAnalysisPrompt:380',
  name: 'buildAnalysisPrompt',
  file: 'api/index.js',
  startLine: 380,
  endLine: 408,
  async: false,
  params: ["question"],
  exported: false
})
CREATE (fapi_index_js)-[:CONTAINS]->(fnapi_index_js_buildAnalysisPrompt_380);

MATCH (fapi_index_js:File {path: 'api/index.js'})
CREATE (fnapi_index_js_detectMediaType_548:Function {
  id: 'api/index.js:detectMediaType:548',
  name: 'detectMediaType',
  file: 'api/index.js',
  startLine: 548,
  endLine: 562,
  async: false,
  params: ["buffer"],
  exported: false
})
CREATE (fapi_index_js)-[:CONTAINS]->(fnapi_index_js_detectMediaType_548);

MATCH (fapi_index_js:File {path: 'api/index.js'})
CREATE (fnapi_index_js_compressImageForAPI_577:Function {
  id: 'api/index.js:compressImageForAPI:577',
  name: 'compressImageForAPI',
  file: 'api/index.js',
  startLine: 577,
  endLine: 698,
  async: true,
  params: ["imageBuffer","mediaType"],
  exported: false
})
CREATE (fapi_index_js)-[:CONTAINS]->(fnapi_index_js_compressImageForAPI_577);

MATCH (fapi_index_js:File {path: 'api/index.js'})
CREATE (fnapi_index_js_sendEvent_717:Function {
  id: 'api/index.js:sendEvent:717',
  name: 'sendEvent',
  file: 'api/index.js',
  startLine: 717,
  endLine: 722,
  async: false,
  params: ["event","data"],
  exported: false
})
CREATE (fapi_index_js)-[:CONTAINS]->(fnapi_index_js_sendEvent_717);

MATCH (fapi_llm_index_js:File {path: 'api/llm/index.js'})
CREATE (fnapi_llm_index_js_getAdapter_28:Function {
  id: 'api/llm/index.js:getAdapter:28',
  name: 'getAdapter',
  file: 'api/llm/index.js',
  startLine: 28,
  endLine: 44,
  async: false,
  params: ["provider=default","config=default"],
  exported: false
})
CREATE (fapi_llm_index_js)-[:CONTAINS]->(fnapi_llm_index_js_getAdapter_28);

MATCH (fapi_llm_index_js:File {path: 'api/llm/index.js'})
CREATE (fnapi_llm_index_js_getDefaultAdapter_51:Function {
  id: 'api/llm/index.js:getDefaultAdapter:51',
  name: 'getDefaultAdapter',
  file: 'api/llm/index.js',
  startLine: 51,
  endLine: 54,
  async: false,
  params: ["config=default"],
  exported: false
})
CREATE (fapi_llm_index_js)-[:CONTAINS]->(fnapi_llm_index_js_getDefaultAdapter_51);

MATCH (fapi_llm_index_js:File {path: 'api/llm/index.js'})
CREATE (fnapi_llm_index_js_getVisionAdapter_61:Function {
  id: 'api/llm/index.js:getVisionAdapter:61',
  name: 'getVisionAdapter',
  file: 'api/llm/index.js',
  startLine: 61,
  endLine: 71,
  async: false,
  params: ["config=default"],
  exported: false
})
CREATE (fapi_llm_index_js)-[:CONTAINS]->(fnapi_llm_index_js_getVisionAdapter_61);

MATCH (fapi_llm_index_js:File {path: 'api/llm/index.js'})
CREATE (fnapi_llm_index_js_getResearchAdapter_79:Function {
  id: 'api/llm/index.js:getResearchAdapter:79',
  name: 'getResearchAdapter',
  file: 'api/llm/index.js',
  startLine: 79,
  endLine: 82,
  async: false,
  params: ["config=default"],
  exported: false
})
CREATE (fapi_llm_index_js)-[:CONTAINS]->(fnapi_llm_index_js_getResearchAdapter_79);

MATCH (fapi_llm_index_js:File {path: 'api/llm/index.js'})
CREATE (fnapi_llm_index_js_registerProvider_89:Function {
  id: 'api/llm/index.js:registerProvider:89',
  name: 'registerProvider',
  file: 'api/llm/index.js',
  startLine: 89,
  endLine: 94,
  async: false,
  params: ["name","AdapterClass"],
  exported: false
})
CREATE (fapi_llm_index_js)-[:CONTAINS]->(fnapi_llm_index_js_registerProvider_89);

MATCH (fapi_llm_index_js:File {path: 'api/llm/index.js'})
CREATE (fnapi_llm_index_js_listProviders_100:Function {
  id: 'api/llm/index.js:listProviders:100',
  name: 'listProviders',
  file: 'api/llm/index.js',
  startLine: 100,
  endLine: 102,
  async: false,
  params: [],
  exported: false
})
CREATE (fapi_llm_index_js)-[:CONTAINS]->(fnapi_llm_index_js_listProviders_100);

MATCH (fapi_llm_index_js:File {path: 'api/llm/index.js'})
CREATE (fnapi_llm_index_js_clearCache_107:Function {
  id: 'api/llm/index.js:clearCache:107',
  name: 'clearCache',
  file: 'api/llm/index.js',
  startLine: 107,
  endLine: 109,
  async: false,
  params: [],
  exported: false
})
CREATE (fapi_llm_index_js)-[:CONTAINS]->(fnapi_llm_index_js_clearCache_107);

MATCH (fpublic_canvas_html_script_0:File {path: 'public/canvas.html:script:0'})
CREATE (fnpublic_canvas_html_script_0_showState_27:Function {
  id: 'public/canvas.html:script:0:showState:27',
  name: 'showState',
  file: 'public/canvas.html:script:0',
  startLine: 27,
  endLine: 39,
  async: false,
  params: ["name"],
  exported: false
})
CREATE (fpublic_canvas_html_script_0)-[:CONTAINS]->(fnpublic_canvas_html_script_0_showState_27);

MATCH (fpublic_canvas_html_script_0:File {path: 'public/canvas.html:script:0'})
CREATE (fnpublic_canvas_html_script_0_checkUrlForJob_42:Function {
  id: 'public/canvas.html:script:0:checkUrlForJob:42',
  name: 'checkUrlForJob',
  file: 'public/canvas.html:script:0',
  startLine: 42,
  endLine: 54,
  async: false,
  params: [],
  exported: false
})
CREATE (fpublic_canvas_html_script_0)-[:CONTAINS]->(fnpublic_canvas_html_script_0_checkUrlForJob_42);

MATCH (fpublic_canvas_html_script_0:File {path: 'public/canvas.html:script:0'})
CREATE (fnpublic_canvas_html_script_0_handleFile_57:Function {
  id: 'public/canvas.html:script:0:handleFile:57',
  name: 'handleFile',
  file: 'public/canvas.html:script:0',
  startLine: 57,
  endLine: 77,
  async: false,
  params: ["file"],
  exported: false
})
CREATE (fpublic_canvas_html_script_0)-[:CONTAINS]->(fnpublic_canvas_html_script_0_handleFile_57);

MATCH (fpublic_canvas_html_script_0:File {path: 'public/canvas.html:script:0'})
CREATE (fnpublic_canvas_html_script_0_uploadAndGenerate_80:Function {
  id: 'public/canvas.html:script:0:uploadAndGenerate:80',
  name: 'uploadAndGenerate',
  file: 'public/canvas.html:script:0',
  startLine: 80,
  endLine: 118,
  async: true,
  params: [],
  exported: false
})
CREATE (fpublic_canvas_html_script_0)-[:CONTAINS]->(fnpublic_canvas_html_script_0_uploadAndGenerate_80);

MATCH (fpublic_canvas_html_script_0:File {path: 'public/canvas.html:script:0'})
CREATE (fnpublic_canvas_html_script_0_startStream_121:Function {
  id: 'public/canvas.html:script:0:startStream:121',
  name: 'startStream',
  file: 'public/canvas.html:script:0',
  startLine: 121,
  endLine: 173,
  async: false,
  params: ["jobId"],
  exported: false
})
CREATE (fpublic_canvas_html_script_0)-[:CONTAINS]->(fnpublic_canvas_html_script_0_startStream_121);

MATCH (fpublic_canvas_html_script_0:File {path: 'public/canvas.html:script:0'})
CREATE (fnpublic_canvas_html_script_0_renderCanvas_176:Function {
  id: 'public/canvas.html:script:0:renderCanvas:176',
  name: 'renderCanvas',
  file: 'public/canvas.html:script:0',
  startLine: 176,
  endLine: 190,
  async: false,
  params: ["html"],
  exported: false
})
CREATE (fpublic_canvas_html_script_0)-[:CONTAINS]->(fnpublic_canvas_html_script_0_renderCanvas_176);

MATCH (fpublic_canvas_html_script_0:File {path: 'public/canvas.html:script:0'})
CREATE (fnpublic_canvas_html_script_0_showError_193:Function {
  id: 'public/canvas.html:script:0:showError:193',
  name: 'showError',
  file: 'public/canvas.html:script:0',
  startLine: 193,
  endLine: 196,
  async: false,
  params: ["message"],
  exported: false
})
CREATE (fpublic_canvas_html_script_0)-[:CONTAINS]->(fnpublic_canvas_html_script_0_showError_193);

MATCH (fpublic_canvas_html_script_0:File {path: 'public/canvas.html:script:0'})
CREATE (fnpublic_canvas_html_script_0_reset_199:Function {
  id: 'public/canvas.html:script:0:reset:199',
  name: 'reset',
  file: 'public/canvas.html:script:0',
  startLine: 199,
  endLine: 210,
  async: false,
  params: [],
  exported: false
})
CREATE (fpublic_canvas_html_script_0)-[:CONTAINS]->(fnpublic_canvas_html_script_0_reset_199);

MATCH (fpublic_index_html_script_0:File {path: 'public/index.html:script:0'})
CREATE (fnpublic_index_html_script_0_handleFile_59:Function {
  id: 'public/index.html:script:0:handleFile:59',
  name: 'handleFile',
  file: 'public/index.html:script:0',
  startLine: 59,
  endLine: 82,
  async: false,
  params: ["file"],
  exported: false
})
CREATE (fpublic_index_html_script_0)-[:CONTAINS]->(fnpublic_index_html_script_0_handleFile_59);

MATCH (fpublic_index_html_script_0:File {path: 'public/index.html:script:0'})
CREATE (fnpublic_index_html_script_0_setLoading_133:Function {
  id: 'public/index.html:script:0:setLoading:133',
  name: 'setLoading',
  file: 'public/index.html:script:0',
  startLine: 133,
  endLine: 137,
  async: false,
  params: ["loading"],
  exported: false
})
CREATE (fpublic_index_html_script_0)-[:CONTAINS]->(fnpublic_index_html_script_0_setLoading_133);

MATCH (fpublic_index_html_script_0:File {path: 'public/index.html:script:0'})
CREATE (fnpublic_index_html_script_0_showError_139:Function {
  id: 'public/index.html:script:0:showError:139',
  name: 'showError',
  file: 'public/index.html:script:0',
  startLine: 139,
  endLine: 142,
  async: false,
  params: ["message"],
  exported: false
})
CREATE (fpublic_index_html_script_0)-[:CONTAINS]->(fnpublic_index_html_script_0_showError_139);

MATCH (fpublic_index_html_script_0:File {path: 'public/index.html:script:0'})
CREATE (fnpublic_index_html_script_0_hideError_144:Function {
  id: 'public/index.html:script:0:hideError:144',
  name: 'hideError',
  file: 'public/index.html:script:0',
  startLine: 144,
  endLine: 146,
  async: false,
  params: [],
  exported: false
})
CREATE (fpublic_index_html_script_0)-[:CONTAINS]->(fnpublic_index_html_script_0_hideError_144);

MATCH (fpublic_index_html_script_0:File {path: 'public/index.html:script:0'})
CREATE (fnpublic_index_html_script_0_showSuccess_148:Function {
  id: 'public/index.html:script:0:showSuccess:148',
  name: 'showSuccess',
  file: 'public/index.html:script:0',
  startLine: 148,
  endLine: 170,
  async: false,
  params: ["jobId","viewUrl"],
  exported: false
})
CREATE (fpublic_index_html_script_0)-[:CONTAINS]->(fnpublic_index_html_script_0_showSuccess_148);

MATCH (fpublic_index_html_script_0:File {path: 'public/index.html:script:0'})
CREATE (fnpublic_index_html_script_0_resetForm_172:Function {
  id: 'public/index.html:script:0:resetForm:172',
  name: 'resetForm',
  file: 'public/index.html:script:0',
  startLine: 172,
  endLine: 190,
  async: false,
  params: [],
  exported: false
})
CREATE (fpublic_index_html_script_0)-[:CONTAINS]->(fnpublic_index_html_script_0_resetForm_172);

MATCH (fpublic_job_html_script_1:File {path: 'public/job.html:script:1'})
CREATE (fnpublic_job_html_script_1_init_37:Function {
  id: 'public/job.html:script:1:init:37',
  name: 'init',
  file: 'public/job.html:script:1',
  startLine: 37,
  endLine: 48,
  async: false,
  params: [],
  exported: false
})
CREATE (fpublic_job_html_script_1)-[:CONTAINS]->(fnpublic_job_html_script_1_init_37);

MATCH (fpublic_job_html_script_1:File {path: 'public/job.html:script:1'})
CREATE (fnpublic_job_html_script_1_connectToStream_50:Function {
  id: 'public/job.html:script:1:connectToStream:50',
  name: 'connectToStream',
  file: 'public/job.html:script:1',
  startLine: 50,
  endLine: 88,
  async: false,
  params: [],
  exported: false
})
CREATE (fpublic_job_html_script_1)-[:CONTAINS]->(fnpublic_job_html_script_1_connectToStream_50);

MATCH (fpublic_job_html_script_1:File {path: 'public/job.html:script:1'})
CREATE (fnpublic_job_html_script_1_handleInit_90:Function {
  id: 'public/job.html:script:1:handleInit:90',
  name: 'handleInit',
  file: 'public/job.html:script:1',
  startLine: 90,
  endLine: 107,
  async: false,
  params: ["data"],
  exported: false
})
CREATE (fpublic_job_html_script_1)-[:CONTAINS]->(fnpublic_job_html_script_1_handleInit_90);

MATCH (fpublic_job_html_script_1:File {path: 'public/job.html:script:1'})
CREATE (fnpublic_job_html_script_1_updateProgress_109:Function {
  id: 'public/job.html:script:1:updateProgress:109',
  name: 'updateProgress',
  file: 'public/job.html:script:1',
  startLine: 109,
  endLine: 124,
  async: false,
  params: ["data"],
  exported: false
})
CREATE (fpublic_job_html_script_1)-[:CONTAINS]->(fnpublic_job_html_script_1_updateProgress_109);

MATCH (fpublic_job_html_script_1:File {path: 'public/job.html:script:1'})
CREATE (fnpublic_job_html_script_1_appendToken_126:Function {
  id: 'public/job.html:script:1:appendToken:126',
  name: 'appendToken',
  file: 'public/job.html:script:1',
  startLine: 126,
  endLine: 130,
  async: false,
  params: ["text"],
  exported: false
})
CREATE (fpublic_job_html_script_1)-[:CONTAINS]->(fnpublic_job_html_script_1_appendToken_126);

MATCH (fpublic_job_html_script_1:File {path: 'public/job.html:script:1'})
CREATE (fnpublic_job_html_script_1_handleComplete_132:Function {
  id: 'public/job.html:script:1:handleComplete:132',
  name: 'handleComplete',
  file: 'public/job.html:script:1',
  startLine: 132,
  endLine: 149,
  async: false,
  params: ["data"],
  exported: false
})
CREATE (fpublic_job_html_script_1)-[:CONTAINS]->(fnpublic_job_html_script_1_handleComplete_132);

MATCH (fpublic_job_html_script_1:File {path: 'public/job.html:script:1'})
CREATE (fnpublic_job_html_script_1_fallbackToPoll_151:Function {
  id: 'public/job.html:script:1:fallbackToPoll:151',
  name: 'fallbackToPoll',
  file: 'public/job.html:script:1',
  startLine: 151,
  endLine: 192,
  async: true,
  params: [],
  exported: false
})
CREATE (fpublic_job_html_script_1)-[:CONTAINS]->(fnpublic_job_html_script_1_fallbackToPoll_151);

MATCH (fpublic_job_html_script_1:File {path: 'public/job.html:script:1'})
CREATE (fnpublic_job_html_script_1_showError_194:Function {
  id: 'public/job.html:script:1:showError:194',
  name: 'showError',
  file: 'public/job.html:script:1',
  startLine: 194,
  endLine: 199,
  async: false,
  params: ["message"],
  exported: false
})
CREATE (fpublic_job_html_script_1)-[:CONTAINS]->(fnpublic_job_html_script_1_showError_194);

MATCH (fpublic_paste_html_script_1:File {path: 'public/paste.html:script:1'})
CREATE (fnpublic_paste_html_script_1_showState_27:Function {
  id: 'public/paste.html:script:1:showState:27',
  name: 'showState',
  file: 'public/paste.html:script:1',
  startLine: 27,
  endLine: 30,
  async: false,
  params: ["name"],
  exported: false
})
CREATE (fpublic_paste_html_script_1)-[:CONTAINS]->(fnpublic_paste_html_script_1_showState_27);

MATCH (fpublic_paste_html_script_1:File {path: 'public/paste.html:script:1'})
CREATE (fnpublic_paste_html_script_1_readClipboard_33:Function {
  id: 'public/paste.html:script:1:readClipboard:33',
  name: 'readClipboard',
  file: 'public/paste.html:script:1',
  startLine: 33,
  endLine: 57,
  async: true,
  params: [],
  exported: false
})
CREATE (fpublic_paste_html_script_1)-[:CONTAINS]->(fnpublic_paste_html_script_1_readClipboard_33);

MATCH (fpublic_paste_html_script_1:File {path: 'public/paste.html:script:1'})
CREATE (fnpublic_paste_html_script_1_handleImage_59:Function {
  id: 'public/paste.html:script:1:handleImage:59',
  name: 'handleImage',
  file: 'public/paste.html:script:1',
  startLine: 59,
  endLine: 70,
  async: false,
  params: ["blob","type"],
  exported: false
})
CREATE (fpublic_paste_html_script_1)-[:CONTAINS]->(fnpublic_paste_html_script_1_handleImage_59);

MATCH (fpublic_paste_html_script_1:File {path: 'public/paste.html:script:1'})
CREATE (fnpublic_paste_html_script_1_uploadAndStream_72:Function {
  id: 'public/paste.html:script:1:uploadAndStream:72',
  name: 'uploadAndStream',
  file: 'public/paste.html:script:1',
  startLine: 72,
  endLine: 95,
  async: true,
  params: [],
  exported: false
})
CREATE (fpublic_paste_html_script_1)-[:CONTAINS]->(fnpublic_paste_html_script_1_uploadAndStream_72);

MATCH (fpublic_paste_html_script_1:File {path: 'public/paste.html:script:1'})
CREATE (fnpublic_paste_html_script_1_startStream_97:Function {
  id: 'public/paste.html:script:1:startStream:97',
  name: 'startStream',
  file: 'public/paste.html:script:1',
  startLine: 97,
  endLine: 183,
  async: true,
  params: ["jobId"],
  exported: false
})
CREATE (fpublic_paste_html_script_1)-[:CONTAINS]->(fnpublic_paste_html_script_1_startStream_97);

MATCH (fpublic_paste_html_script_1:File {path: 'public/paste.html:script:1'})
CREATE (fnpublic_paste_html_script_1_renderMarkdown_185:Function {
  id: 'public/paste.html:script:1:renderMarkdown:185',
  name: 'renderMarkdown',
  file: 'public/paste.html:script:1',
  startLine: 185,
  endLine: 188,
  async: false,
  params: [],
  exported: false
})
CREATE (fpublic_paste_html_script_1)-[:CONTAINS]->(fnpublic_paste_html_script_1_renderMarkdown_185);

MATCH (fpublic_paste_html_script_1:File {path: 'public/paste.html:script:1'})
CREATE (fnpublic_paste_html_script_1_scrollToBottom_190:Function {
  id: 'public/paste.html:script:1:scrollToBottom:190',
  name: 'scrollToBottom',
  file: 'public/paste.html:script:1',
  startLine: 190,
  endLine: 194,
  async: false,
  params: [],
  exported: false
})
CREATE (fpublic_paste_html_script_1)-[:CONTAINS]->(fnpublic_paste_html_script_1_scrollToBottom_190);

MATCH (fpublic_paste_html_script_1:File {path: 'public/paste.html:script:1'})
CREATE (fnpublic_paste_html_script_1_showError_231:Function {
  id: 'public/paste.html:script:1:showError:231',
  name: 'showError',
  file: 'public/paste.html:script:1',
  startLine: 231,
  endLine: 234,
  async: false,
  params: ["message"],
  exported: false
})
CREATE (fpublic_paste_html_script_1)-[:CONTAINS]->(fnpublic_paste_html_script_1_showError_231);

MATCH (fpublic_paste_html_script_1:File {path: 'public/paste.html:script:1'})
CREATE (fnpublic_paste_html_script_1_reset_236:Function {
  id: 'public/paste.html:script:1:reset:236',
  name: 'reset',
  file: 'public/paste.html:script:1',
  startLine: 236,
  endLine: 245,
  async: false,
  params: [],
  exported: false
})
CREATE (fpublic_paste_html_script_1)-[:CONTAINS]->(fnpublic_paste_html_script_1_reset_236);


// ============================================
// CREATE ENDPOINTS
// ============================================

MATCH (fapi_index_js:File {path: 'api/index.js'})
CREATE (eUSE_:Endpoint {
  id: 'USE:',
  method: 'USE',
  path: '',
  handler: 'anonymous',
  file: 'api/index.js',
  line: 110,
  middleware: []
})
CREATE (fapi_index_js)-[:DEFINES]->(eUSE_);

MATCH (fapi_index_js:File {path: 'api/index.js'})
CREATE (eUSE_:Endpoint {
  id: 'USE:',
  method: 'USE',
  path: '',
  handler: 'anonymous',
  file: 'api/index.js',
  line: 111,
  middleware: []
})
CREATE (fapi_index_js)-[:DEFINES]->(eUSE_);

MATCH (fapi_index_js:File {path: 'api/index.js'})
CREATE (eUSE_:Endpoint {
  id: 'USE:',
  method: 'USE',
  path: '',
  handler: 'anonymous',
  file: 'api/index.js',
  line: 114,
  middleware: []
})
CREATE (fapi_index_js)-[:DEFINES]->(eUSE_);

MATCH (fapi_index_js:File {path: 'api/index.js'})
CREATE (eGET__paste:Endpoint {
  id: 'GET:/paste',
  method: 'GET',
  path: '/paste',
  handler: 'inline@117',
  file: 'api/index.js',
  line: 117,
  middleware: []
})
CREATE (fapi_index_js)-[:DEFINES]->(eGET__paste);

MATCH (fapi_index_js:File {path: 'api/index.js'})
CREATE (eGET__:Endpoint {
  id: 'GET:/',
  method: 'GET',
  path: '/',
  handler: 'inline@122',
  file: 'api/index.js',
  line: 122,
  middleware: []
})
CREATE (fapi_index_js)-[:DEFINES]->(eGET__);

MATCH (fapi_index_js:File {path: 'api/index.js'})
CREATE (eGET__api_health:Endpoint {
  id: 'GET:/api/health',
  method: 'GET',
  path: '/api/health',
  handler: 'inline@128',
  file: 'api/index.js',
  line: 128,
  middleware: []
})
CREATE (fapi_index_js)-[:DEFINES]->(eGET__api_health);

MATCH (fapi_index_js:File {path: 'api/index.js'})
CREATE (eGET__canvas:Endpoint {
  id: 'GET:/canvas',
  method: 'GET',
  path: '/canvas',
  handler: 'inline@147',
  file: 'api/index.js',
  line: 147,
  middleware: []
})
CREATE (fapi_index_js)-[:DEFINES]->(eGET__canvas);

MATCH (fapi_index_js:File {path: 'api/index.js'})
CREATE (ePOST__api_generate:Endpoint {
  id: 'POST:/api/generate',
  method: 'POST',
  path: '/api/generate',
  handler: 'inline@152',
  file: 'api/index.js',
  line: 152,
  middleware: ["anonymous"]
})
CREATE (fapi_index_js)-[:DEFINES]->(ePOST__api_generate);

MATCH (fapi_index_js:File {path: 'api/index.js'})
CREATE (eGET__api_job__jobId_canvas:Endpoint {
  id: 'GET:/api/job/:jobId/canvas',
  method: 'GET',
  path: '/api/job/:jobId/canvas',
  handler: 'inline@242',
  file: 'api/index.js',
  line: 242,
  middleware: []
})
CREATE (fapi_index_js)-[:DEFINES]->(eGET__api_job__jobId_canvas);

MATCH (fapi_index_js:File {path: 'api/index.js'})
CREATE (ePOST__api_investigate__hotspotId:Endpoint {
  id: 'POST:/api/investigate/:hotspotId',
  method: 'POST',
  path: '/api/investigate/:hotspotId',
  handler: 'inline@364',
  file: 'api/index.js',
  line: 364,
  middleware: []
})
CREATE (fapi_index_js)-[:DEFINES]->(ePOST__api_investigate__hotspotId);

MATCH (fapi_index_js:File {path: 'api/index.js'})
CREATE (ePOST__api_upload:Endpoint {
  id: 'POST:/api/upload',
  method: 'POST',
  path: '/api/upload',
  handler: 'inline@416',
  file: 'api/index.js',
  line: 416,
  middleware: ["anonymous"]
})
CREATE (fapi_index_js)-[:DEFINES]->(ePOST__api_upload);

MATCH (fapi_index_js:File {path: 'api/index.js'})
CREATE (eGET__api_job__jobId_stream:Endpoint {
  id: 'GET:/api/job/:jobId/stream',
  method: 'GET',
  path: '/api/job/:jobId/stream',
  handler: 'inline@704',
  file: 'api/index.js',
  line: 704,
  middleware: []
})
CREATE (fapi_index_js)-[:DEFINES]->(eGET__api_job__jobId_stream);

MATCH (fapi_index_js:File {path: 'api/index.js'})
CREATE (eGET__api_job__jobId_status:Endpoint {
  id: 'GET:/api/job/:jobId/status',
  method: 'GET',
  path: '/api/job/:jobId/status',
  handler: 'inline@944',
  file: 'api/index.js',
  line: 944,
  middleware: []
})
CREATE (fapi_index_js)-[:DEFINES]->(eGET__api_job__jobId_status);

MATCH (fapi_index_js:File {path: 'api/index.js'})
CREATE (eGET__api_job__jobId_image:Endpoint {
  id: 'GET:/api/job/:jobId/image',
  method: 'GET',
  path: '/api/job/:jobId/image',
  handler: 'inline@981',
  file: 'api/index.js',
  line: 981,
  middleware: []
})
CREATE (fapi_index_js)-[:DEFINES]->(eGET__api_job__jobId_image);

MATCH (fapi_index_js:File {path: 'api/index.js'})
CREATE (ePOST__api_analyze:Endpoint {
  id: 'POST:/api/analyze',
  method: 'POST',
  path: '/api/analyze',
  handler: 'inline@1001',
  file: 'api/index.js',
  line: 1001,
  middleware: ["anonymous"]
})
CREATE (fapi_index_js)-[:DEFINES]->(ePOST__api_analyze);

MATCH (fapi_index_js:File {path: 'api/index.js'})
CREATE (eGET__api_jobs:Endpoint {
  id: 'GET:/api/jobs',
  method: 'GET',
  path: '/api/jobs',
  handler: 'inline@1088',
  file: 'api/index.js',
  line: 1088,
  middleware: []
})
CREATE (fapi_index_js)-[:DEFINES]->(eGET__api_jobs);

MATCH (fapi_index_js:File {path: 'api/index.js'})
CREATE (eUSE_:Endpoint {
  id: 'USE:',
  method: 'USE',
  path: '',
  handler: 'inline@1101',
  file: 'api/index.js',
  line: 1101,
  middleware: []
})
CREATE (fapi_index_js)-[:DEFINES]->(eUSE_);

MATCH (fapi_index_js:File {path: 'api/index.js'})
CREATE (eGET__UUID_REGEX_:Endpoint {
  id: 'GET:[UUID_REGEX]',
  method: 'GET',
  path: '[UUID_REGEX]',
  handler: 'inline@1122',
  file: 'api/index.js',
  line: 1122,
  middleware: []
})
CREATE (fapi_index_js)-[:DEFINES]->(eGET__UUID_REGEX_);

MATCH (fapi_index_js:File {path: 'api/index.js'})
CREATE (eGET__:Endpoint {
  id: 'GET:*',
  method: 'GET',
  path: '*',
  handler: 'inline@1140',
  file: 'api/index.js',
  line: 1140,
  middleware: []
})
CREATE (fapi_index_js)-[:DEFINES]->(eGET__);


// ============================================
// CREATE FUNCTION CALLS
// ============================================

MATCH (fnapi_generators_html_generator_js_generateHotspotHTML_32:Function {id: 'api/generators/html-generator.js:generateHotspotHTML:32'})
MATCH (fnapi_generators_html_generator_js_escapeHtml_16:Function {id: 'api/generators/html-generator.js:escapeHtml:16'})
MERGE (fnapi_generators_html_generator_js_generateHotspotHTML_32)-[:CALLS {line: 47, file: 'api/generators/html-generator.js'}]->(fnapi_generators_html_generator_js_escapeHtml_16);

MATCH (fnapi_generators_html_generator_js_generateHotspotHTML_32:Function {id: 'api/generators/html-generator.js:generateHotspotHTML:32'})
MATCH (fnapi_generators_html_generator_js_escapeHtml_16:Function {id: 'api/generators/html-generator.js:escapeHtml:16'})
MERGE (fnapi_generators_html_generator_js_generateHotspotHTML_32)-[:CALLS {line: 59, file: 'api/generators/html-generator.js'}]->(fnapi_generators_html_generator_js_escapeHtml_16);

MATCH (fnapi_generators_html_generator_js_generateHotspotHTML_32:Function {id: 'api/generators/html-generator.js:generateHotspotHTML:32'})
MATCH (fnapi_generators_html_generator_js_escapeHtml_16:Function {id: 'api/generators/html-generator.js:escapeHtml:16'})
MERGE (fnapi_generators_html_generator_js_generateHotspotHTML_32)-[:CALLS {line: 60, file: 'api/generators/html-generator.js'}]->(fnapi_generators_html_generator_js_escapeHtml_16);

MATCH (fnapi_generators_html_generator_js_generateHotspotHTML_32:Function {id: 'api/generators/html-generator.js:generateHotspotHTML:32'})
MATCH (fnapi_generators_html_generator_js_escapeHtml_16:Function {id: 'api/generators/html-generator.js:escapeHtml:16'})
MERGE (fnapi_generators_html_generator_js_generateHotspotHTML_32)-[:CALLS {line: 61, file: 'api/generators/html-generator.js'}]->(fnapi_generators_html_generator_js_escapeHtml_16);

MATCH (fnapi_generators_html_generator_js_generateHotspotHTML_32:Function {id: 'api/generators/html-generator.js:generateHotspotHTML:32'})
MATCH (fnapi_generators_html_generator_js_escapeHtml_16:Function {id: 'api/generators/html-generator.js:escapeHtml:16'})
MERGE (fnapi_generators_html_generator_js_generateHotspotHTML_32)-[:CALLS {line: 65, file: 'api/generators/html-generator.js'}]->(fnapi_generators_html_generator_js_escapeHtml_16);

MATCH (fnapi_generators_html_generator_js_generateHotspotHTML_32:Function {id: 'api/generators/html-generator.js:generateHotspotHTML:32'})
MATCH (fnapi_generators_html_generator_js_escapeHtml_16:Function {id: 'api/generators/html-generator.js:escapeHtml:16'})
MERGE (fnapi_generators_html_generator_js_generateHotspotHTML_32)-[:CALLS {line: 66, file: 'api/generators/html-generator.js'}]->(fnapi_generators_html_generator_js_escapeHtml_16);

MATCH (fnapi_generators_html_generator_js_generateHotspotHTML_32:Function {id: 'api/generators/html-generator.js:generateHotspotHTML:32'})
MATCH (fnapi_generators_html_generator_js_escapeHtml_16:Function {id: 'api/generators/html-generator.js:escapeHtml:16'})
MERGE (fnapi_generators_html_generator_js_generateHotspotHTML_32)-[:CALLS {line: 67, file: 'api/generators/html-generator.js'}]->(fnapi_generators_html_generator_js_escapeHtml_16);

MATCH (fnapi_generators_html_generator_js_generateHotspotHTML_32:Function {id: 'api/generators/html-generator.js:generateHotspotHTML:32'})
MATCH (fnapi_generators_html_generator_js_escapeHtml_16:Function {id: 'api/generators/html-generator.js:escapeHtml:16'})
MERGE (fnapi_generators_html_generator_js_generateHotspotHTML_32)-[:CALLS {line: 68, file: 'api/generators/html-generator.js'}]->(fnapi_generators_html_generator_js_escapeHtml_16);

MATCH (fnapi_generators_html_generator_js_generateNoiseRegionHTML_78:Function {id: 'api/generators/html-generator.js:generateNoiseRegionHTML:78'})
MATCH (fnapi_generators_html_generator_js_escapeHtml_16:Function {id: 'api/generators/html-generator.js:escapeHtml:16'})
MERGE (fnapi_generators_html_generator_js_generateNoiseRegionHTML_78)-[:CALLS {line: 91, file: 'api/generators/html-generator.js'}]->(fnapi_generators_html_generator_js_escapeHtml_16);

MATCH (fnapi_generators_html_generator_js_generateNoiseRegionHTML_78:Function {id: 'api/generators/html-generator.js:generateNoiseRegionHTML:78'})
MATCH (fnapi_generators_html_generator_js_escapeHtml_16:Function {id: 'api/generators/html-generator.js:escapeHtml:16'})
MERGE (fnapi_generators_html_generator_js_generateNoiseRegionHTML_78)-[:CALLS {line: 92, file: 'api/generators/html-generator.js'}]->(fnapi_generators_html_generator_js_escapeHtml_16);

MATCH (fnapi_generators_html_generator_js_generateNoiseRegionHTML_78:Function {id: 'api/generators/html-generator.js:generateNoiseRegionHTML:78'})
MATCH (fnapi_generators_html_generator_js_escapeHtml_16:Function {id: 'api/generators/html-generator.js:escapeHtml:16'})
MERGE (fnapi_generators_html_generator_js_generateNoiseRegionHTML_78)-[:CALLS {line: 94, file: 'api/generators/html-generator.js'}]->(fnapi_generators_html_generator_js_escapeHtml_16);

MATCH (fnapi_generators_html_generator_js_generateContextBar_104:Function {id: 'api/generators/html-generator.js:generateContextBar:104'})
MATCH (fnapi_generators_html_generator_js_escapeHtml_16:Function {id: 'api/generators/html-generator.js:escapeHtml:16'})
MERGE (fnapi_generators_html_generator_js_generateContextBar_104)-[:CALLS {line: 110, file: 'api/generators/html-generator.js'}]->(fnapi_generators_html_generator_js_escapeHtml_16);

MATCH (fnapi_generators_html_generator_js_generateHTML_301:Function {id: 'api/generators/html-generator.js:generateHTML:301'})
MATCH (fnapi_generators_style_manager_js_generateBaseCSS_244:Function {id: 'api/generators/style-manager.js:generateBaseCSS:244'})
MERGE (fnapi_generators_html_generator_js_generateHTML_301)-[:CALLS {line: 302, file: 'api/generators/html-generator.js'}]->(fnapi_generators_style_manager_js_generateBaseCSS_244);

MATCH (fnapi_generators_html_generator_js_generateHTML_301:Function {id: 'api/generators/html-generator.js:generateHTML:301'})
MATCH (fnapi_generators_html_generator_js_generateContextBar_104:Function {id: 'api/generators/html-generator.js:generateContextBar:104'})
MERGE (fnapi_generators_html_generator_js_generateHTML_301)-[:CALLS {line: 303, file: 'api/generators/html-generator.js'}]->(fnapi_generators_html_generator_js_generateContextBar_104);

MATCH (fnapi_generators_html_generator_js_generateHTML_301:Function {id: 'api/generators/html-generator.js:generateHTML:301'})
MATCH (fnapi_generators_html_generator_js_generateHotspotHTML_32:Function {id: 'api/generators/html-generator.js:generateHotspotHTML:32'})
MERGE (fnapi_generators_html_generator_js_generateHTML_301)-[:CALLS {line: 304, file: 'api/generators/html-generator.js'}]->(fnapi_generators_html_generator_js_generateHotspotHTML_32);

MATCH (fnapi_generators_html_generator_js_generateHTML_301:Function {id: 'api/generators/html-generator.js:generateHTML:301'})
MATCH (fnapi_generators_html_generator_js_generateNoiseRegionHTML_78:Function {id: 'api/generators/html-generator.js:generateNoiseRegionHTML:78'})
MERGE (fnapi_generators_html_generator_js_generateHTML_301)-[:CALLS {line: 305, file: 'api/generators/html-generator.js'}]->(fnapi_generators_html_generator_js_generateNoiseRegionHTML_78);

MATCH (fnapi_generators_html_generator_js_generateHTML_301:Function {id: 'api/generators/html-generator.js:generateHTML:301'})
MATCH (fnapi_generators_html_generator_js_generateResearchPanelCSS_221:Function {id: 'api/generators/html-generator.js:generateResearchPanelCSS:221'})
MERGE (fnapi_generators_html_generator_js_generateHTML_301)-[:CALLS {line: 306, file: 'api/generators/html-generator.js'}]->(fnapi_generators_html_generator_js_generateResearchPanelCSS_221);

MATCH (fnapi_generators_html_generator_js_generateHTML_301:Function {id: 'api/generators/html-generator.js:generateHTML:301'})
MATCH (fnapi_generators_html_generator_js_generateClientScript_119:Function {id: 'api/generators/html-generator.js:generateClientScript:119'})
MERGE (fnapi_generators_html_generator_js_generateHTML_301)-[:CALLS {line: 307, file: 'api/generators/html-generator.js'}]->(fnapi_generators_html_generator_js_generateClientScript_119);

MATCH (fnapi_generators_html_generator_js_generateHTMLStream_356:Function {id: 'api/generators/html-generator.js:generateHTMLStream:356'})
MATCH (fnapi_generators_style_manager_js_generateBaseCSS_244:Function {id: 'api/generators/style-manager.js:generateBaseCSS:244'})
MERGE (fnapi_generators_html_generator_js_generateHTMLStream_356)-[:CALLS {line: 357, file: 'api/generators/html-generator.js'}]->(fnapi_generators_style_manager_js_generateBaseCSS_244);

MATCH (fnapi_generators_html_generator_js_generateHTMLStream_356:Function {id: 'api/generators/html-generator.js:generateHTMLStream:356'})
MATCH (fnapi_generators_html_generator_js_generateContextBar_104:Function {id: 'api/generators/html-generator.js:generateContextBar:104'})
MERGE (fnapi_generators_html_generator_js_generateHTMLStream_356)-[:CALLS {line: 358, file: 'api/generators/html-generator.js'}]->(fnapi_generators_html_generator_js_generateContextBar_104);

MATCH (fnapi_generators_html_generator_js_generateHTMLStream_356:Function {id: 'api/generators/html-generator.js:generateHTMLStream:356'})
MATCH (fnapi_generators_html_generator_js_generateResearchPanelCSS_221:Function {id: 'api/generators/html-generator.js:generateResearchPanelCSS:221'})
MERGE (fnapi_generators_html_generator_js_generateHTMLStream_356)-[:CALLS {line: 359, file: 'api/generators/html-generator.js'}]->(fnapi_generators_html_generator_js_generateResearchPanelCSS_221);

MATCH (fnapi_generators_html_generator_js_generateHTMLStream_356:Function {id: 'api/generators/html-generator.js:generateHTMLStream:356'})
MATCH (fnapi_generators_html_generator_js_generateNoiseRegionHTML_78:Function {id: 'api/generators/html-generator.js:generateNoiseRegionHTML:78'})
MERGE (fnapi_generators_html_generator_js_generateHTMLStream_356)-[:CALLS {line: 391, file: 'api/generators/html-generator.js'}]->(fnapi_generators_html_generator_js_generateNoiseRegionHTML_78);

MATCH (fnapi_generators_html_generator_js_generateHTMLStream_356:Function {id: 'api/generators/html-generator.js:generateHTMLStream:356'})
MATCH (fnapi_generators_html_generator_js_delay_420:Function {id: 'api/generators/html-generator.js:delay:420'})
MERGE (fnapi_generators_html_generator_js_generateHTMLStream_356)-[:CALLS {line: 392, file: 'api/generators/html-generator.js'}]->(fnapi_generators_html_generator_js_delay_420);

MATCH (fnapi_generators_html_generator_js_generateHTMLStream_356:Function {id: 'api/generators/html-generator.js:generateHTMLStream:356'})
MATCH (fnapi_generators_html_generator_js_generateHotspotHTML_32:Function {id: 'api/generators/html-generator.js:generateHotspotHTML:32'})
MERGE (fnapi_generators_html_generator_js_generateHTMLStream_356)-[:CALLS {line: 400, file: 'api/generators/html-generator.js'}]->(fnapi_generators_html_generator_js_generateHotspotHTML_32);

MATCH (fnapi_generators_html_generator_js_generateHTMLStream_356:Function {id: 'api/generators/html-generator.js:generateHTMLStream:356'})
MATCH (fnapi_generators_html_generator_js_delay_420:Function {id: 'api/generators/html-generator.js:delay:420'})
MERGE (fnapi_generators_html_generator_js_generateHTMLStream_356)-[:CALLS {line: 402, file: 'api/generators/html-generator.js'}]->(fnapi_generators_html_generator_js_delay_420);

MATCH (fnapi_generators_html_generator_js_generateHTMLStream_356:Function {id: 'api/generators/html-generator.js:generateHTMLStream:356'})
MATCH (fnapi_generators_html_generator_js_generateClientScript_119:Function {id: 'api/generators/html-generator.js:generateClientScript:119'})
MERGE (fnapi_generators_html_generator_js_generateHTMLStream_356)-[:CALLS {line: 406, file: 'api/generators/html-generator.js'}]->(fnapi_generators_html_generator_js_generateClientScript_119);

MATCH (fnapi_generators_style_manager_js_adjustColor_113:Function {id: 'api/generators/style-manager.js:adjustColor:113'})
MATCH (fnapi_generators_style_manager_js_adjust_119:Function {id: 'api/generators/style-manager.js:adjust:119'})
MERGE (fnapi_generators_style_manager_js_adjustColor_113)-[:CALLS {line: 126, file: 'api/generators/style-manager.js'}]->(fnapi_generators_style_manager_js_adjust_119);

MATCH (fnapi_generators_style_manager_js_adjustColor_113:Function {id: 'api/generators/style-manager.js:adjustColor:113'})
MATCH (fnapi_generators_style_manager_js_adjust_119:Function {id: 'api/generators/style-manager.js:adjust:119'})
MERGE (fnapi_generators_style_manager_js_adjustColor_113)-[:CALLS {line: 127, file: 'api/generators/style-manager.js'}]->(fnapi_generators_style_manager_js_adjust_119);

MATCH (fnapi_generators_style_manager_js_adjustColor_113:Function {id: 'api/generators/style-manager.js:adjustColor:113'})
MATCH (fnapi_generators_style_manager_js_adjust_119:Function {id: 'api/generators/style-manager.js:adjust:119'})
MERGE (fnapi_generators_style_manager_js_adjustColor_113)-[:CALLS {line: 128, file: 'api/generators/style-manager.js'}]->(fnapi_generators_style_manager_js_adjust_119);

MATCH (fnapi_generators_style_manager_js_createStyleManifest_152:Function {id: 'api/generators/style-manager.js:createStyleManifest:152'})
MATCH (fnapi_generators_style_manager_js_adjustColor_113:Function {id: 'api/generators/style-manager.js:adjustColor:113'})
MERGE (fnapi_generators_style_manager_js_createStyleManifest_152)-[:CALLS {line: 172, file: 'api/generators/style-manager.js'}]->(fnapi_generators_style_manager_js_adjustColor_113);

MATCH (fnapi_generators_style_manager_js_createStyleManifest_152:Function {id: 'api/generators/style-manager.js:createStyleManifest:152'})
MATCH (fnapi_generators_style_manager_js_adjustColor_113:Function {id: 'api/generators/style-manager.js:adjustColor:113'})
MERGE (fnapi_generators_style_manager_js_createStyleManifest_152)-[:CALLS {line: 173, file: 'api/generators/style-manager.js'}]->(fnapi_generators_style_manager_js_adjustColor_113);

MATCH (fnapi_generators_style_manager_js_createStyleManifest_152:Function {id: 'api/generators/style-manager.js:createStyleManifest:152'})
MATCH (fnapi_generators_style_manager_js_adjustColor_113:Function {id: 'api/generators/style-manager.js:adjustColor:113'})
MERGE (fnapi_generators_style_manager_js_createStyleManifest_152)-[:CALLS {line: 176, file: 'api/generators/style-manager.js'}]->(fnapi_generators_style_manager_js_adjustColor_113);

MATCH (fnapi_generators_style_manager_js_createStyleManifest_152:Function {id: 'api/generators/style-manager.js:createStyleManifest:152'})
MATCH (fnapi_generators_style_manager_js_adjustColor_113:Function {id: 'api/generators/style-manager.js:adjustColor:113'})
MERGE (fnapi_generators_style_manager_js_createStyleManifest_152)-[:CALLS {line: 177, file: 'api/generators/style-manager.js'}]->(fnapi_generators_style_manager_js_adjustColor_113);

MATCH (fnapi_generators_style_manager_js_createStyleManifest_152:Function {id: 'api/generators/style-manager.js:createStyleManifest:152'})
MATCH (fnapi_generators_style_manager_js_adjustColor_113:Function {id: 'api/generators/style-manager.js:adjustColor:113'})
MERGE (fnapi_generators_style_manager_js_createStyleManifest_152)-[:CALLS {line: 180, file: 'api/generators/style-manager.js'}]->(fnapi_generators_style_manager_js_adjustColor_113);

MATCH (fnapi_generators_style_manager_js_createStyleManifest_152:Function {id: 'api/generators/style-manager.js:createStyleManifest:152'})
MATCH (fnapi_generators_style_manager_js_hexToRgba_139:Function {id: 'api/generators/style-manager.js:hexToRgba:139'})
MERGE (fnapi_generators_style_manager_js_createStyleManifest_152)-[:CALLS {line: 181, file: 'api/generators/style-manager.js'}]->(fnapi_generators_style_manager_js_hexToRgba_139);

MATCH (fnapi_generators_style_manager_js_generateBaseCSS_244:Function {id: 'api/generators/style-manager.js:generateBaseCSS:244'})
MATCH (fnapi_generators_style_manager_js_generateCSSString_231:Function {id: 'api/generators/style-manager.js:generateCSSString:231'})
MERGE (fnapi_generators_style_manager_js_generateBaseCSS_244)-[:CALLS {line: 245, file: 'api/generators/style-manager.js'}]->(fnapi_generators_style_manager_js_generateCSSString_231);

MATCH (fnapi_generators_vision_analyzer_js_analyzeScreenshot_130:Function {id: 'api/generators/vision-analyzer.js:analyzeScreenshot:130'})
MATCH (fnapi_llm_index_js_getVisionAdapter_61:Function {id: 'api/llm/index.js:getVisionAdapter:61'})
MERGE (fnapi_generators_vision_analyzer_js_analyzeScreenshot_130)-[:CALLS {line: 131, file: 'api/generators/vision-analyzer.js'}]->(fnapi_llm_index_js_getVisionAdapter_61);

MATCH (fnapi_generators_vision_analyzer_js_analyzeScreenshot_130:Function {id: 'api/generators/vision-analyzer.js:analyzeScreenshot:130'})
MATCH (fnapi_generators_vision_analyzer_js_parseAnalysisFromText_151:Function {id: 'api/generators/vision-analyzer.js:parseAnalysisFromText:151'})
MERGE (fnapi_generators_vision_analyzer_js_analyzeScreenshot_130)-[:CALLS {line: 141, file: 'api/generators/vision-analyzer.js'}]->(fnapi_generators_vision_analyzer_js_parseAnalysisFromText_151);

MATCH (fnapi_generators_vision_analyzer_js_analyzeScreenshot_130:Function {id: 'api/generators/vision-analyzer.js:analyzeScreenshot:130'})
MATCH (fnapi_generators_vision_analyzer_js_normalizeAnalysis_180:Function {id: 'api/generators/vision-analyzer.js:normalizeAnalysis:180'})
MERGE (fnapi_generators_vision_analyzer_js_analyzeScreenshot_130)-[:CALLS {line: 143, file: 'api/generators/vision-analyzer.js'}]->(fnapi_generators_vision_analyzer_js_normalizeAnalysis_180);

MATCH (fnapi_generators_vision_analyzer_js_normalizeAnalysis_180:Function {id: 'api/generators/vision-analyzer.js:normalizeAnalysis:180'})
MATCH (fnapi_generators_vision_analyzer_js_normalizeBounds_228:Function {id: 'api/generators/vision-analyzer.js:normalizeBounds:228'})
MERGE (fnapi_generators_vision_analyzer_js_normalizeAnalysis_180)-[:CALLS {line: 194, file: 'api/generators/vision-analyzer.js'}]->(fnapi_generators_vision_analyzer_js_normalizeBounds_228);

MATCH (fnapi_generators_vision_analyzer_js_normalizeAnalysis_180:Function {id: 'api/generators/vision-analyzer.js:normalizeAnalysis:180'})
MATCH (fnapi_generators_vision_analyzer_js_normalizeBounds_228:Function {id: 'api/generators/vision-analyzer.js:normalizeBounds:228'})
MERGE (fnapi_generators_vision_analyzer_js_normalizeAnalysis_180)-[:CALLS {line: 209, file: 'api/generators/vision-analyzer.js'}]->(fnapi_generators_vision_analyzer_js_normalizeBounds_228);

MATCH (fnapi_generators_vision_analyzer_js_normalizeBounds_228:Function {id: 'api/generators/vision-analyzer.js:normalizeBounds:228'})
MATCH (fnapi_generators_vision_analyzer_js_clamp_244:Function {id: 'api/generators/vision-analyzer.js:clamp:244'})
MERGE (fnapi_generators_vision_analyzer_js_normalizeBounds_228)-[:CALLS {line: 234, file: 'api/generators/vision-analyzer.js'}]->(fnapi_generators_vision_analyzer_js_clamp_244);

MATCH (fnapi_generators_vision_analyzer_js_normalizeBounds_228:Function {id: 'api/generators/vision-analyzer.js:normalizeBounds:228'})
MATCH (fnapi_generators_vision_analyzer_js_clamp_244:Function {id: 'api/generators/vision-analyzer.js:clamp:244'})
MERGE (fnapi_generators_vision_analyzer_js_normalizeBounds_228)-[:CALLS {line: 235, file: 'api/generators/vision-analyzer.js'}]->(fnapi_generators_vision_analyzer_js_clamp_244);

MATCH (fnapi_generators_vision_analyzer_js_normalizeBounds_228:Function {id: 'api/generators/vision-analyzer.js:normalizeBounds:228'})
MATCH (fnapi_generators_vision_analyzer_js_clamp_244:Function {id: 'api/generators/vision-analyzer.js:clamp:244'})
MERGE (fnapi_generators_vision_analyzer_js_normalizeBounds_228)-[:CALLS {line: 236, file: 'api/generators/vision-analyzer.js'}]->(fnapi_generators_vision_analyzer_js_clamp_244);

MATCH (fnapi_generators_vision_analyzer_js_normalizeBounds_228:Function {id: 'api/generators/vision-analyzer.js:normalizeBounds:228'})
MATCH (fnapi_generators_vision_analyzer_js_clamp_244:Function {id: 'api/generators/vision-analyzer.js:clamp:244'})
MERGE (fnapi_generators_vision_analyzer_js_normalizeBounds_228)-[:CALLS {line: 237, file: 'api/generators/vision-analyzer.js'}]->(fnapi_generators_vision_analyzer_js_clamp_244);

MATCH (fnapi_llm_index_js_getDefaultAdapter_51:Function {id: 'api/llm/index.js:getDefaultAdapter:51'})
MATCH (fnapi_llm_index_js_getAdapter_28:Function {id: 'api/llm/index.js:getAdapter:28'})
MERGE (fnapi_llm_index_js_getDefaultAdapter_51)-[:CALLS {line: 53, file: 'api/llm/index.js'}]->(fnapi_llm_index_js_getAdapter_28);

MATCH (fnapi_llm_index_js_getVisionAdapter_61:Function {id: 'api/llm/index.js:getVisionAdapter:61'})
MATCH (fnapi_llm_index_js_getAdapter_28:Function {id: 'api/llm/index.js:getAdapter:28'})
MERGE (fnapi_llm_index_js_getVisionAdapter_61)-[:CALLS {line: 64, file: 'api/llm/index.js'}]->(fnapi_llm_index_js_getAdapter_28);

MATCH (fnapi_llm_index_js_getResearchAdapter_79:Function {id: 'api/llm/index.js:getResearchAdapter:79'})
MATCH (fnapi_llm_index_js_getAdapter_28:Function {id: 'api/llm/index.js:getAdapter:28'})
MERGE (fnapi_llm_index_js_getResearchAdapter_79)-[:CALLS {line: 81, file: 'api/llm/index.js'}]->(fnapi_llm_index_js_getAdapter_28);

MATCH (fnpublic_canvas_html_script_0_checkUrlForJob_42:Function {id: 'public/canvas.html:script:0:checkUrlForJob:42'})
MATCH (fnpublic_canvas_html_script_0_showState_27:Function {id: 'public/canvas.html:script:0:showState:27'})
MERGE (fnpublic_canvas_html_script_0_checkUrlForJob_42)-[:CALLS {line: 48, file: 'public/canvas.html:script:0'}]->(fnpublic_canvas_html_script_0_showState_27);

MATCH (fnpublic_canvas_html_script_0_checkUrlForJob_42:Function {id: 'public/canvas.html:script:0:checkUrlForJob:42'})
MATCH (fnpublic_canvas_html_script_0_startStream_121:Function {id: 'public/canvas.html:script:0:startStream:121'})
MERGE (fnpublic_canvas_html_script_0_checkUrlForJob_42)-[:CALLS {line: 50, file: 'public/canvas.html:script:0'}]->(fnpublic_canvas_html_script_0_startStream_121);

MATCH (fnpublic_canvas_html_script_0_handleFile_57:Function {id: 'public/canvas.html:script:0:handleFile:57'})
MATCH (fnpublic_canvas_html_script_0_showError_193:Function {id: 'public/canvas.html:script:0:showError:193'})
MERGE (fnpublic_canvas_html_script_0_handleFile_57)-[:CALLS {line: 59, file: 'public/canvas.html:script:0'}]->(fnpublic_canvas_html_script_0_showError_193);

MATCH (fnpublic_canvas_html_script_0_handleFile_57:Function {id: 'public/canvas.html:script:0:handleFile:57'})
MATCH (fnpublic_canvas_html_script_0_showError_193:Function {id: 'public/canvas.html:script:0:showError:193'})
MERGE (fnpublic_canvas_html_script_0_handleFile_57)-[:CALLS {line: 64, file: 'public/canvas.html:script:0'}]->(fnpublic_canvas_html_script_0_showError_193);

MATCH (fnpublic_canvas_html_script_0_uploadAndGenerate_80:Function {id: 'public/canvas.html:script:0:uploadAndGenerate:80'})
MATCH (fnpublic_canvas_html_script_0_showState_27:Function {id: 'public/canvas.html:script:0:showState:27'})
MERGE (fnpublic_canvas_html_script_0_uploadAndGenerate_80)-[:CALLS {line: 85, file: 'public/canvas.html:script:0'}]->(fnpublic_canvas_html_script_0_showState_27);

MATCH (fnpublic_canvas_html_script_0_uploadAndGenerate_80:Function {id: 'public/canvas.html:script:0:uploadAndGenerate:80'})
MATCH (fnpublic_canvas_html_script_0_startStream_121:Function {id: 'public/canvas.html:script:0:startStream:121'})
MERGE (fnpublic_canvas_html_script_0_uploadAndGenerate_80)-[:CALLS {line: 113, file: 'public/canvas.html:script:0'}]->(fnpublic_canvas_html_script_0_startStream_121);

MATCH (fnpublic_canvas_html_script_0_uploadAndGenerate_80:Function {id: 'public/canvas.html:script:0:uploadAndGenerate:80'})
MATCH (fnpublic_canvas_html_script_0_showError_193:Function {id: 'public/canvas.html:script:0:showError:193'})
MERGE (fnpublic_canvas_html_script_0_uploadAndGenerate_80)-[:CALLS {line: 116, file: 'public/canvas.html:script:0'}]->(fnpublic_canvas_html_script_0_showError_193);

MATCH (fnpublic_canvas_html_script_0_startStream_121:Function {id: 'public/canvas.html:script:0:startStream:121'})
MATCH (fnpublic_canvas_html_script_0_renderCanvas_176:Function {id: 'public/canvas.html:script:0:renderCanvas:176'})
MERGE (fnpublic_canvas_html_script_0_startStream_121)-[:CALLS {line: 153, file: 'public/canvas.html:script:0'}]->(fnpublic_canvas_html_script_0_renderCanvas_176);

MATCH (fnpublic_canvas_html_script_0_startStream_121:Function {id: 'public/canvas.html:script:0:startStream:121'})
MATCH (fnpublic_canvas_html_script_0_showError_193:Function {id: 'public/canvas.html:script:0:showError:193'})
MERGE (fnpublic_canvas_html_script_0_startStream_121)-[:CALLS {line: 162, file: 'public/canvas.html:script:0'}]->(fnpublic_canvas_html_script_0_showError_193);

MATCH (fnpublic_canvas_html_script_0_startStream_121:Function {id: 'public/canvas.html:script:0:startStream:121'})
MATCH (fnpublic_canvas_html_script_0_showError_193:Function {id: 'public/canvas.html:script:0:showError:193'})
MERGE (fnpublic_canvas_html_script_0_startStream_121)-[:CALLS {line: 164, file: 'public/canvas.html:script:0'}]->(fnpublic_canvas_html_script_0_showError_193);

MATCH (fnpublic_canvas_html_script_0_startStream_121:Function {id: 'public/canvas.html:script:0:startStream:121'})
MATCH (fnpublic_canvas_html_script_0_showError_193:Function {id: 'public/canvas.html:script:0:showError:193'})
MERGE (fnpublic_canvas_html_script_0_startStream_121)-[:CALLS {line: 170, file: 'public/canvas.html:script:0'}]->(fnpublic_canvas_html_script_0_showError_193);

MATCH (fnpublic_canvas_html_script_0_renderCanvas_176:Function {id: 'public/canvas.html:script:0:renderCanvas:176'})
MATCH (fnpublic_canvas_html_script_0_showState_27:Function {id: 'public/canvas.html:script:0:showState:27'})
MERGE (fnpublic_canvas_html_script_0_renderCanvas_176)-[:CALLS {line: 177, file: 'public/canvas.html:script:0'}]->(fnpublic_canvas_html_script_0_showState_27);

MATCH (fnpublic_canvas_html_script_0_showError_193:Function {id: 'public/canvas.html:script:0:showError:193'})
MATCH (fnpublic_canvas_html_script_0_showState_27:Function {id: 'public/canvas.html:script:0:showState:27'})
MERGE (fnpublic_canvas_html_script_0_showError_193)-[:CALLS {line: 195, file: 'public/canvas.html:script:0'}]->(fnpublic_canvas_html_script_0_showState_27);

MATCH (fnpublic_canvas_html_script_0_reset_199:Function {id: 'public/canvas.html:script:0:reset:199'})
MATCH (fnpublic_canvas_html_script_0_showState_27:Function {id: 'public/canvas.html:script:0:showState:27'})
MERGE (fnpublic_canvas_html_script_0_reset_199)-[:CALLS {line: 208, file: 'public/canvas.html:script:0'}]->(fnpublic_canvas_html_script_0_showState_27);

MATCH (fnpublic_canvas_html_script_0_handleFile_57:Function {id: 'public/canvas.html:script:0:handleFile:57'})
MATCH (fnpublic_canvas_html_script_0_showError_193:Function {id: 'public/canvas.html:script:0:showError:193'})
MERGE (fnpublic_canvas_html_script_0_handleFile_57)-[:CALLS {line: 61, file: 'public/index.html:script:0'}]->(fnpublic_canvas_html_script_0_showError_193);

MATCH (fnpublic_canvas_html_script_0_handleFile_57:Function {id: 'public/canvas.html:script:0:handleFile:57'})
MATCH (fnpublic_canvas_html_script_0_showError_193:Function {id: 'public/canvas.html:script:0:showError:193'})
MERGE (fnpublic_canvas_html_script_0_handleFile_57)-[:CALLS {line: 66, file: 'public/index.html:script:0'}]->(fnpublic_canvas_html_script_0_showError_193);

MATCH (fnpublic_canvas_html_script_0_handleFile_57:Function {id: 'public/canvas.html:script:0:handleFile:57'})
MATCH (fnpublic_index_html_script_0_hideError_144:Function {id: 'public/index.html:script:0:hideError:144'})
MERGE (fnpublic_canvas_html_script_0_handleFile_57)-[:CALLS {line: 71, file: 'public/index.html:script:0'}]->(fnpublic_index_html_script_0_hideError_144);

MATCH (fnpublic_index_html_script_0_resetForm_172:Function {id: 'public/index.html:script:0:resetForm:172'})
MATCH (fnpublic_index_html_script_0_setLoading_133:Function {id: 'public/index.html:script:0:setLoading:133'})
MERGE (fnpublic_index_html_script_0_resetForm_172)-[:CALLS {line: 186, file: 'public/index.html:script:0'}]->(fnpublic_index_html_script_0_setLoading_133);

MATCH (fnpublic_index_html_script_0_resetForm_172:Function {id: 'public/index.html:script:0:resetForm:172'})
MATCH (fnpublic_index_html_script_0_hideError_144:Function {id: 'public/index.html:script:0:hideError:144'})
MERGE (fnpublic_index_html_script_0_resetForm_172)-[:CALLS {line: 189, file: 'public/index.html:script:0'}]->(fnpublic_index_html_script_0_hideError_144);

MATCH (fnpublic_job_html_script_1_init_37:Function {id: 'public/job.html:script:1:init:37'})
MATCH (fnpublic_canvas_html_script_0_showError_193:Function {id: 'public/canvas.html:script:0:showError:193'})
MERGE (fnpublic_job_html_script_1_init_37)-[:CALLS {line: 39, file: 'public/job.html:script:1'}]->(fnpublic_canvas_html_script_0_showError_193);

MATCH (fnpublic_job_html_script_1_init_37:Function {id: 'public/job.html:script:1:init:37'})
MATCH (fnpublic_job_html_script_1_connectToStream_50:Function {id: 'public/job.html:script:1:connectToStream:50'})
MERGE (fnpublic_job_html_script_1_init_37)-[:CALLS {line: 47, file: 'public/job.html:script:1'}]->(fnpublic_job_html_script_1_connectToStream_50);

MATCH (fnpublic_job_html_script_1_connectToStream_50:Function {id: 'public/job.html:script:1:connectToStream:50'})
MATCH (fnpublic_job_html_script_1_handleInit_90:Function {id: 'public/job.html:script:1:handleInit:90'})
MERGE (fnpublic_job_html_script_1_connectToStream_50)-[:CALLS {line: 55, file: 'public/job.html:script:1'}]->(fnpublic_job_html_script_1_handleInit_90);

MATCH (fnpublic_job_html_script_1_connectToStream_50:Function {id: 'public/job.html:script:1:connectToStream:50'})
MATCH (fnpublic_job_html_script_1_updateProgress_109:Function {id: 'public/job.html:script:1:updateProgress:109'})
MERGE (fnpublic_job_html_script_1_connectToStream_50)-[:CALLS {line: 60, file: 'public/job.html:script:1'}]->(fnpublic_job_html_script_1_updateProgress_109);

MATCH (fnpublic_job_html_script_1_connectToStream_50:Function {id: 'public/job.html:script:1:connectToStream:50'})
MATCH (fnpublic_job_html_script_1_appendToken_126:Function {id: 'public/job.html:script:1:appendToken:126'})
MERGE (fnpublic_job_html_script_1_connectToStream_50)-[:CALLS {line: 65, file: 'public/job.html:script:1'}]->(fnpublic_job_html_script_1_appendToken_126);

MATCH (fnpublic_job_html_script_1_connectToStream_50:Function {id: 'public/job.html:script:1:connectToStream:50'})
MATCH (fnpublic_job_html_script_1_handleComplete_132:Function {id: 'public/job.html:script:1:handleComplete:132'})
MERGE (fnpublic_job_html_script_1_connectToStream_50)-[:CALLS {line: 70, file: 'public/job.html:script:1'}]->(fnpublic_job_html_script_1_handleComplete_132);

MATCH (fnpublic_job_html_script_1_connectToStream_50:Function {id: 'public/job.html:script:1:connectToStream:50'})
MATCH (fnpublic_canvas_html_script_0_showError_193:Function {id: 'public/canvas.html:script:0:showError:193'})
MERGE (fnpublic_job_html_script_1_connectToStream_50)-[:CALLS {line: 77, file: 'public/job.html:script:1'}]->(fnpublic_canvas_html_script_0_showError_193);

MATCH (fnpublic_job_html_script_1_connectToStream_50:Function {id: 'public/job.html:script:1:connectToStream:50'})
MATCH (fnpublic_job_html_script_1_fallbackToPoll_151:Function {id: 'public/job.html:script:1:fallbackToPoll:151'})
MERGE (fnpublic_job_html_script_1_connectToStream_50)-[:CALLS {line: 79, file: 'public/job.html:script:1'}]->(fnpublic_job_html_script_1_fallbackToPoll_151);

MATCH (fnpublic_job_html_script_1_connectToStream_50:Function {id: 'public/job.html:script:1:connectToStream:50'})
MATCH (fnpublic_job_html_script_1_fallbackToPoll_151:Function {id: 'public/job.html:script:1:fallbackToPoll:151'})
MERGE (fnpublic_job_html_script_1_connectToStream_50)-[:CALLS {line: 85, file: 'public/job.html:script:1'}]->(fnpublic_job_html_script_1_fallbackToPoll_151);

MATCH (fnpublic_job_html_script_1_handleInit_90:Function {id: 'public/job.html:script:1:handleInit:90'})
MATCH (fnpublic_job_html_script_1_updateProgress_109:Function {id: 'public/job.html:script:1:updateProgress:109'})
MERGE (fnpublic_job_html_script_1_handleInit_90)-[:CALLS {line: 102, file: 'public/job.html:script:1'}]->(fnpublic_job_html_script_1_updateProgress_109);

MATCH (fnpublic_job_html_script_1_fallbackToPoll_151:Function {id: 'public/job.html:script:1:fallbackToPoll:151'})
MATCH (fnpublic_canvas_html_script_0_showError_193:Function {id: 'public/canvas.html:script:0:showError:193'})
MERGE (fnpublic_job_html_script_1_fallbackToPoll_151)-[:CALLS {line: 157, file: 'public/job.html:script:1'}]->(fnpublic_canvas_html_script_0_showError_193);

MATCH (fnpublic_job_html_script_1_fallbackToPoll_151:Function {id: 'public/job.html:script:1:fallbackToPoll:151'})
MATCH (fnpublic_job_html_script_1_updateProgress_109:Function {id: 'public/job.html:script:1:updateProgress:109'})
MERGE (fnpublic_job_html_script_1_fallbackToPoll_151)-[:CALLS {line: 172, file: 'public/job.html:script:1'}]->(fnpublic_job_html_script_1_updateProgress_109);

MATCH (fnpublic_job_html_script_1_fallbackToPoll_151:Function {id: 'public/job.html:script:1:fallbackToPoll:151'})
MATCH (fnpublic_job_html_script_1_handleComplete_132:Function {id: 'public/job.html:script:1:handleComplete:132'})
MERGE (fnpublic_job_html_script_1_fallbackToPoll_151)-[:CALLS {line: 183, file: 'public/job.html:script:1'}]->(fnpublic_job_html_script_1_handleComplete_132);

MATCH (fnpublic_job_html_script_1_fallbackToPoll_151:Function {id: 'public/job.html:script:1:fallbackToPoll:151'})
MATCH (fnpublic_canvas_html_script_0_showError_193:Function {id: 'public/canvas.html:script:0:showError:193'})
MERGE (fnpublic_job_html_script_1_fallbackToPoll_151)-[:CALLS {line: 185, file: 'public/job.html:script:1'}]->(fnpublic_canvas_html_script_0_showError_193);

MATCH (fnpublic_job_html_script_1_fallbackToPoll_151:Function {id: 'public/job.html:script:1:fallbackToPoll:151'})
MATCH (fnpublic_canvas_html_script_0_showError_193:Function {id: 'public/canvas.html:script:0:showError:193'})
MERGE (fnpublic_job_html_script_1_fallbackToPoll_151)-[:CALLS {line: 190, file: 'public/job.html:script:1'}]->(fnpublic_canvas_html_script_0_showError_193);

MATCH (fnpublic_paste_html_script_1_readClipboard_33:Function {id: 'public/paste.html:script:1:readClipboard:33'})
MATCH (fnpublic_paste_html_script_1_handleImage_59:Function {id: 'public/paste.html:script:1:handleImage:59'})
MERGE (fnpublic_paste_html_script_1_readClipboard_33)-[:CALLS {line: 41, file: 'public/paste.html:script:1'}]->(fnpublic_paste_html_script_1_handleImage_59);

MATCH (fnpublic_paste_html_script_1_readClipboard_33:Function {id: 'public/paste.html:script:1:readClipboard:33'})
MATCH (fnpublic_canvas_html_script_0_showError_193:Function {id: 'public/canvas.html:script:0:showError:193'})
MERGE (fnpublic_paste_html_script_1_readClipboard_33)-[:CALLS {line: 47, file: 'public/paste.html:script:1'}]->(fnpublic_canvas_html_script_0_showError_193);

MATCH (fnpublic_paste_html_script_1_readClipboard_33:Function {id: 'public/paste.html:script:1:readClipboard:33'})
MATCH (fnpublic_canvas_html_script_0_showError_193:Function {id: 'public/canvas.html:script:0:showError:193'})
MERGE (fnpublic_paste_html_script_1_readClipboard_33)-[:CALLS {line: 52, file: 'public/paste.html:script:1'}]->(fnpublic_canvas_html_script_0_showError_193);

MATCH (fnpublic_paste_html_script_1_readClipboard_33:Function {id: 'public/paste.html:script:1:readClipboard:33'})
MATCH (fnpublic_canvas_html_script_0_showError_193:Function {id: 'public/canvas.html:script:0:showError:193'})
MERGE (fnpublic_paste_html_script_1_readClipboard_33)-[:CALLS {line: 54, file: 'public/paste.html:script:1'}]->(fnpublic_canvas_html_script_0_showError_193);

MATCH (fnpublic_paste_html_script_1_handleImage_59:Function {id: 'public/paste.html:script:1:handleImage:59'})
MATCH (fnpublic_canvas_html_script_0_showState_27:Function {id: 'public/canvas.html:script:0:showState:27'})
MERGE (fnpublic_paste_html_script_1_handleImage_59)-[:CALLS {line: 66, file: 'public/paste.html:script:1'}]->(fnpublic_canvas_html_script_0_showState_27);

MATCH (fnpublic_paste_html_script_1_handleImage_59:Function {id: 'public/paste.html:script:1:handleImage:59'})
MATCH (fnpublic_paste_html_script_1_uploadAndStream_72:Function {id: 'public/paste.html:script:1:uploadAndStream:72'})
MERGE (fnpublic_paste_html_script_1_handleImage_59)-[:CALLS {line: 69, file: 'public/paste.html:script:1'}]->(fnpublic_paste_html_script_1_uploadAndStream_72);

MATCH (fnpublic_paste_html_script_1_uploadAndStream_72:Function {id: 'public/paste.html:script:1:uploadAndStream:72'})
MATCH (fnpublic_canvas_html_script_0_startStream_121:Function {id: 'public/canvas.html:script:0:startStream:121'})
MERGE (fnpublic_paste_html_script_1_uploadAndStream_72)-[:CALLS {line: 90, file: 'public/paste.html:script:1'}]->(fnpublic_canvas_html_script_0_startStream_121);

MATCH (fnpublic_paste_html_script_1_uploadAndStream_72:Function {id: 'public/paste.html:script:1:uploadAndStream:72'})
MATCH (fnpublic_canvas_html_script_0_showError_193:Function {id: 'public/canvas.html:script:0:showError:193'})
MERGE (fnpublic_paste_html_script_1_uploadAndStream_72)-[:CALLS {line: 93, file: 'public/paste.html:script:1'}]->(fnpublic_canvas_html_script_0_showError_193);

MATCH (fnpublic_canvas_html_script_0_startStream_121:Function {id: 'public/canvas.html:script:0:startStream:121'})
MATCH (fnpublic_canvas_html_script_0_showState_27:Function {id: 'public/canvas.html:script:0:showState:27'})
MERGE (fnpublic_canvas_html_script_0_startStream_121)-[:CALLS {line: 138, file: 'public/paste.html:script:1'}]->(fnpublic_canvas_html_script_0_showState_27);

MATCH (fnpublic_canvas_html_script_0_startStream_121:Function {id: 'public/canvas.html:script:0:startStream:121'})
MATCH (fnpublic_paste_html_script_1_renderMarkdown_185:Function {id: 'public/paste.html:script:1:renderMarkdown:185'})
MERGE (fnpublic_canvas_html_script_0_startStream_121)-[:CALLS {line: 143, file: 'public/paste.html:script:1'}]->(fnpublic_paste_html_script_1_renderMarkdown_185);

MATCH (fnpublic_canvas_html_script_0_startStream_121:Function {id: 'public/canvas.html:script:0:startStream:121'})
MATCH (fnpublic_paste_html_script_1_scrollToBottom_190:Function {id: 'public/paste.html:script:1:scrollToBottom:190'})
MERGE (fnpublic_canvas_html_script_0_startStream_121)-[:CALLS {line: 144, file: 'public/paste.html:script:1'}]->(fnpublic_paste_html_script_1_scrollToBottom_190);

MATCH (fnpublic_canvas_html_script_0_startStream_121:Function {id: 'public/canvas.html:script:0:startStream:121'})
MATCH (fnpublic_canvas_html_script_0_showError_193:Function {id: 'public/canvas.html:script:0:showError:193'})
MERGE (fnpublic_canvas_html_script_0_startStream_121)-[:CALLS {line: 156, file: 'public/paste.html:script:1'}]->(fnpublic_canvas_html_script_0_showError_193);

MATCH (fnpublic_canvas_html_script_0_startStream_121:Function {id: 'public/canvas.html:script:0:startStream:121'})
MATCH (fnpublic_canvas_html_script_0_showError_193:Function {id: 'public/canvas.html:script:0:showError:193'})
MERGE (fnpublic_canvas_html_script_0_startStream_121)-[:CALLS {line: 180, file: 'public/paste.html:script:1'}]->(fnpublic_canvas_html_script_0_showError_193);

MATCH (fnpublic_canvas_html_script_0_showError_193:Function {id: 'public/canvas.html:script:0:showError:193'})
MATCH (fnpublic_canvas_html_script_0_showState_27:Function {id: 'public/canvas.html:script:0:showState:27'})
MERGE (fnpublic_canvas_html_script_0_showError_193)-[:CALLS {line: 233, file: 'public/paste.html:script:1'}]->(fnpublic_canvas_html_script_0_showState_27);

MATCH (fnpublic_canvas_html_script_0_reset_199:Function {id: 'public/canvas.html:script:0:reset:199'})
MATCH (fnpublic_canvas_html_script_0_showState_27:Function {id: 'public/canvas.html:script:0:showState:27'})
MERGE (fnpublic_canvas_html_script_0_reset_199)-[:CALLS {line: 244, file: 'public/paste.html:script:1'}]->(fnpublic_canvas_html_script_0_showState_27);


// ============================================
// CREATE UI COMPONENTS
// ============================================

MATCH (fpublic_canvas_html:File {path: 'public/canvas.html'})
CREATE (uipublic_canvas_html_uploadState_state_0:UIComponent {
  id: 'public/canvas.html:uploadState:state:0',
  name: 'uploadState',
  type: 'state',
  file: 'public/canvas.html',
  htmlId: 'uploadState',
  className: 'upload-state'
})
CREATE (fpublic_canvas_html)-[:CONTAINS]->(uipublic_canvas_html_uploadState_state_0);

MATCH (fpublic_canvas_html:File {path: 'public/canvas.html'})
CREATE (uipublic_canvas_html_loadingState_state_1:UIComponent {
  id: 'public/canvas.html:loadingState:state:1',
  name: 'loadingState',
  type: 'state',
  file: 'public/canvas.html',
  htmlId: 'loadingState',
  className: 'loading-state'
})
CREATE (fpublic_canvas_html)-[:CONTAINS]->(uipublic_canvas_html_loadingState_state_1);

MATCH (fpublic_canvas_html:File {path: 'public/canvas.html'})
CREATE (uipublic_canvas_html_canvasState_state_2:UIComponent {
  id: 'public/canvas.html:canvasState:state:2',
  name: 'canvasState',
  type: 'state',
  file: 'public/canvas.html',
  htmlId: 'canvasState',
  className: 'canvas-state'
})
CREATE (fpublic_canvas_html)-[:CONTAINS]->(uipublic_canvas_html_canvasState_state_2);

MATCH (fpublic_canvas_html:File {path: 'public/canvas.html'})
CREATE (uipublic_canvas_html_errorState_state_3:UIComponent {
  id: 'public/canvas.html:errorState:state:3',
  name: 'errorState',
  type: 'state',
  file: 'public/canvas.html',
  htmlId: 'errorState',
  className: 'error-state'
})
CREATE (fpublic_canvas_html)-[:CONTAINS]->(uipublic_canvas_html_errorState_state_3);

MATCH (fpublic_index_html:File {path: 'public/index.html'})
CREATE (uipublic_index_html_upload_section_section_0:UIComponent {
  id: 'public/index.html:upload-section:section:0',
  name: 'upload-section',
  type: 'section',
  file: 'public/index.html',
  htmlId: '',
  className: 'upload-section'
})
CREATE (fpublic_index_html)-[:CONTAINS]->(uipublic_index_html_upload_section_section_0);

MATCH (fpublic_index_html:File {path: 'public/index.html'})
CREATE (uipublic_index_html_successSection_section_1:UIComponent {
  id: 'public/index.html:successSection:section:1',
  name: 'successSection',
  type: 'section',
  file: 'public/index.html',
  htmlId: 'successSection',
  className: 'success-section'
})
CREATE (fpublic_index_html)-[:CONTAINS]->(uipublic_index_html_successSection_section_1);

MATCH (fpublic_index_html:File {path: 'public/index.html'})
CREATE (uipublic_index_html_container_container_0:UIComponent {
  id: 'public/index.html:container:container:0',
  name: 'container',
  type: 'container',
  file: 'public/index.html',
  htmlId: '',
  className: 'container'
})
CREATE (fpublic_index_html)-[:CONTAINS]->(uipublic_index_html_container_container_0);

MATCH (fpublic_index_html:File {path: 'public/index.html'})
CREATE (uipublic_index_html_previewContainer_container_1:UIComponent {
  id: 'public/index.html:previewContainer:container:1',
  name: 'previewContainer',
  type: 'container',
  file: 'public/index.html',
  htmlId: 'previewContainer',
  className: 'preview-container'
})
CREATE (fpublic_index_html)-[:CONTAINS]->(uipublic_index_html_previewContainer_container_1);

MATCH (fpublic_index_html:File {path: 'public/index.html'})
CREATE (uipublic_index_html_job_url_container_container_2:UIComponent {
  id: 'public/index.html:job-url-container:container:2',
  name: 'job-url-container',
  type: 'container',
  file: 'public/index.html',
  htmlId: '',
  className: 'job-url-container'
})
CREATE (fpublic_index_html)-[:CONTAINS]->(uipublic_index_html_job_url_container_container_2);

MATCH (fpublic_index_html:File {path: 'public/index.html'})
CREATE (uipublic_index_html_upload_section_section_0:UIComponent {
  id: 'public/index.html:upload-section:section:0',
  name: 'upload-section',
  type: 'section',
  file: 'public/index.html',
  htmlId: '',
  className: 'upload-section'
})
CREATE (fpublic_index_html)-[:CONTAINS]->(uipublic_index_html_upload_section_section_0);

MATCH (fpublic_index_html:File {path: 'public/index.html'})
CREATE (uipublic_index_html_question_section_section_1:UIComponent {
  id: 'public/index.html:question-section:section:1',
  name: 'question-section',
  type: 'section',
  file: 'public/index.html',
  htmlId: '',
  className: 'question-section'
})
CREATE (fpublic_index_html)-[:CONTAINS]->(uipublic_index_html_question_section_section_1);

MATCH (fpublic_index_html:File {path: 'public/index.html'})
CREATE (uipublic_index_html_successSection_section_2:UIComponent {
  id: 'public/index.html:successSection:section:2',
  name: 'successSection',
  type: 'section',
  file: 'public/index.html',
  htmlId: 'successSection',
  className: 'success-section'
})
CREATE (fpublic_index_html)-[:CONTAINS]->(uipublic_index_html_successSection_section_2);

MATCH (fpublic_job_html:File {path: 'public/job.html'})
CREATE (uipublic_job_html_imageSection_section_0:UIComponent {
  id: 'public/job.html:imageSection:section:0',
  name: 'imageSection',
  type: 'section',
  file: 'public/job.html',
  htmlId: 'imageSection',
  className: 'image-section'
})
CREATE (fpublic_job_html)-[:CONTAINS]->(uipublic_job_html_imageSection_section_0);

MATCH (fpublic_job_html:File {path: 'public/job.html'})
CREATE (uipublic_job_html_progressSection_section_1:UIComponent {
  id: 'public/job.html:progressSection:section:1',
  name: 'progressSection',
  type: 'section',
  file: 'public/job.html',
  htmlId: 'progressSection',
  className: 'progress-section'
})
CREATE (fpublic_job_html)-[:CONTAINS]->(uipublic_job_html_progressSection_section_1);

MATCH (fpublic_job_html:File {path: 'public/job.html'})
CREATE (uipublic_job_html_analysisSection_section_2:UIComponent {
  id: 'public/job.html:analysisSection:section:2',
  name: 'analysisSection',
  type: 'section',
  file: 'public/job.html',
  htmlId: 'analysisSection',
  className: 'analysis-section'
})
CREATE (fpublic_job_html)-[:CONTAINS]->(uipublic_job_html_analysisSection_section_2);

MATCH (fpublic_job_html:File {path: 'public/job.html'})
CREATE (uipublic_job_html_errorSection_section_3:UIComponent {
  id: 'public/job.html:errorSection:section:3',
  name: 'errorSection',
  type: 'section',
  file: 'public/job.html',
  htmlId: 'errorSection',
  className: 'error-section'
})
CREATE (fpublic_job_html)-[:CONTAINS]->(uipublic_job_html_errorSection_section_3);

MATCH (fpublic_job_html:File {path: 'public/job.html'})
CREATE (uipublic_job_html_container_container_0:UIComponent {
  id: 'public/job.html:container:container:0',
  name: 'container',
  type: 'container',
  file: 'public/job.html',
  htmlId: '',
  className: 'container'
})
CREATE (fpublic_job_html)-[:CONTAINS]->(uipublic_job_html_container_container_0);

MATCH (fpublic_job_html:File {path: 'public/job.html'})
CREATE (uipublic_job_html_imageSection_section_0:UIComponent {
  id: 'public/job.html:imageSection:section:0',
  name: 'imageSection',
  type: 'section',
  file: 'public/job.html',
  htmlId: 'imageSection',
  className: 'image-section'
})
CREATE (fpublic_job_html)-[:CONTAINS]->(uipublic_job_html_imageSection_section_0);

MATCH (fpublic_job_html:File {path: 'public/job.html'})
CREATE (uipublic_job_html_progressSection_section_1:UIComponent {
  id: 'public/job.html:progressSection:section:1',
  name: 'progressSection',
  type: 'section',
  file: 'public/job.html',
  htmlId: 'progressSection',
  className: 'progress-section'
})
CREATE (fpublic_job_html)-[:CONTAINS]->(uipublic_job_html_progressSection_section_1);

MATCH (fpublic_job_html:File {path: 'public/job.html'})
CREATE (uipublic_job_html_analysisSection_section_2:UIComponent {
  id: 'public/job.html:analysisSection:section:2',
  name: 'analysisSection',
  type: 'section',
  file: 'public/job.html',
  htmlId: 'analysisSection',
  className: 'analysis-section'
})
CREATE (fpublic_job_html)-[:CONTAINS]->(uipublic_job_html_analysisSection_section_2);

MATCH (fpublic_job_html:File {path: 'public/job.html'})
CREATE (uipublic_job_html_errorSection_section_3:UIComponent {
  id: 'public/job.html:errorSection:section:3',
  name: 'errorSection',
  type: 'section',
  file: 'public/job.html',
  htmlId: 'errorSection',
  className: 'error-section'
})
CREATE (fpublic_job_html)-[:CONTAINS]->(uipublic_job_html_errorSection_section_3);

MATCH (fpublic_paste_html:File {path: 'public/paste.html'})
CREATE (uipublic_paste_html_pasteState_state_0:UIComponent {
  id: 'public/paste.html:pasteState:state:0',
  name: 'pasteState',
  type: 'state',
  file: 'public/paste.html',
  htmlId: 'pasteState',
  className: 'state active'
})
CREATE (fpublic_paste_html)-[:CONTAINS]->(uipublic_paste_html_pasteState_state_0);

MATCH (fpublic_paste_html:File {path: 'public/paste.html'})
CREATE (uipublic_paste_html_analyzeState_state_1:UIComponent {
  id: 'public/paste.html:analyzeState:state:1',
  name: 'analyzeState',
  type: 'state',
  file: 'public/paste.html',
  htmlId: 'analyzeState',
  className: 'state'
})
CREATE (fpublic_paste_html)-[:CONTAINS]->(uipublic_paste_html_analyzeState_state_1);

MATCH (fpublic_paste_html:File {path: 'public/paste.html'})
CREATE (uipublic_paste_html_resultsState_state_2:UIComponent {
  id: 'public/paste.html:resultsState:state:2',
  name: 'resultsState',
  type: 'state',
  file: 'public/paste.html',
  htmlId: 'resultsState',
  className: 'state'
})
CREATE (fpublic_paste_html)-[:CONTAINS]->(uipublic_paste_html_resultsState_state_2);

MATCH (fpublic_paste_html:File {path: 'public/paste.html'})
CREATE (uipublic_paste_html_errorState_state_3:UIComponent {
  id: 'public/paste.html:errorState:state:3',
  name: 'errorState',
  type: 'state',
  file: 'public/paste.html',
  htmlId: 'errorState',
  className: 'state'
})
CREATE (fpublic_paste_html)-[:CONTAINS]->(uipublic_paste_html_errorState_state_3);

MATCH (fpublic_paste_html:File {path: 'public/paste.html'})
CREATE (uipublic_paste_html_scan_container_container_0:UIComponent {
  id: 'public/paste.html:scan-container:container:0',
  name: 'scan-container',
  type: 'container',
  file: 'public/paste.html',
  htmlId: '',
  className: 'scan-container'
})
CREATE (fpublic_paste_html)-[:CONTAINS]->(uipublic_paste_html_scan_container_container_0);

MATCH (fpublic_paste_html:File {path: 'public/paste.html'})
CREATE (uipublic_paste_html_results_image_container_container_1:UIComponent {
  id: 'public/paste.html:results-image-container:container:1',
  name: 'results-image-container',
  type: 'container',
  file: 'public/paste.html',
  htmlId: '',
  className: 'results-image-container'
})
CREATE (fpublic_paste_html)-[:CONTAINS]->(uipublic_paste_html_results_image_container_container_1);


// ============================================
// CREATE UI-API CONNECTIONS
// ============================================


// ============================================
// CREATE SIMILARITY RELATIONSHIPS
// ============================================

MATCH (fnapi_index_js_sendEvent_255:Function {id: 'api/index.js:sendEvent:255'})
MATCH (fnapi_index_js_sendEvent_717:Function {id: 'api/index.js:sendEvent:717'})
MERGE (fnapi_index_js_sendEvent_255)-[:SIMILAR_TO {similarity: 1, type: 'exact-duplicate'}]->(fnapi_index_js_sendEvent_717);


// ============================================
// SUMMARY QUERIES
// ============================================

// View all nodes by type
MATCH (n)
RETURN labels(n)[0] as type, count(*) as count
ORDER BY count DESC;

// View the full graph (run this to see everything)
MATCH (n)
OPTIONAL MATCH (n)-[r]->(m)
RETURN n, r, m
LIMIT 500;

