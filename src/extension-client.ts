// 浏览器扩展通信工具 (Waoowaoo / Qingqiu Writer 共享库)

declare const chrome: any;

export const EXTENSION_ID = 'mpganmobmdpknahcbkphidjeddhnmmee';

export interface ExtensionResponse {
  success: boolean;
  content?: string;
  error?: string;
  [key: string]: unknown;
}

export interface ExtensionFilePayload {
  name: string;
  mediaType: string;
  data: string;
}

// 检查扩展是否可用
export function isExtensionAvailable(): boolean {
  return typeof chrome !== 'undefined' && 
         typeof chrome.runtime !== 'undefined' && 
         typeof chrome.runtime.sendMessage === 'function';
}

// 有副作用的 action（往输入框注入文字）——重试会导致重复注入
const SIDE_EFFECT_ACTIONS = new Set(['sendToDoubao', 'sendToDeepSeek', 'sendToGemini', 'sendToDoubaoImage']);

// 发送消息到扩展（带重试——Chrome MV3 service worker 可能休眠，首次调用可能失败）
export async function sendMessageToExtension(
  action: string,
  data: Record<string, unknown> = {}
): Promise<ExtensionResponse> {
  const hasSideEffect = SIDE_EFFECT_ACTIONS.has(action);
  const MAX_RETRIES = hasSideEffect ? 1 : 3;
  const RETRY_DELAY_MS = 1500;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const resp = await new Promise<ExtensionResponse>((resolve) => {
      if (!isExtensionAvailable()) {
        resolve({
          success: false,
          error: '浏览器扩展未安装或不可用，请先安装 Qingqiu Book 扩展'
        });
        return;
      }

      const message = { action, ...data };

      chrome.runtime.sendMessage(EXTENSION_ID, message, (response: ExtensionResponse) => {
        if (chrome.runtime.lastError) {
          resolve({
            success: false,
            error: chrome.runtime.lastError.message
          });
          return;
        }

        resolve(response || { success: false, error: '无响应' });
      });
    });

    if (resp.success) return resp;
    if (!/扩展未安装|不可用|Extension not found|Could not establish connection/i.test(resp.error || '')) {
      return resp;
    }

    if (attempt < MAX_RETRIES - 1) {
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    } else {
      return resp;
    }
  }
  return { success: false, error: '浏览器扩展重试后仍不可用' };
}

// 发送消息到 DeepSeek
export async function sendToDeepSeek(message: string): Promise<ExtensionResponse> {
  return sendMessageToExtension('sendToDeepSeek', { message });
}

// 发送消息到 Doubao
export async function sendToDoubao(message: string, files?: ExtensionFilePayload[]): Promise<ExtensionResponse> {
  return sendMessageToExtension('sendToDoubao', { message, files: files || [] });
}

// 发送消息到 Gemini
export async function sendToGemini(message: string, files?: ExtensionFilePayload[]): Promise<ExtensionResponse> {
  return sendMessageToExtension('sendToGemini', { message, files: files || [] });
}

// Veo 视频生成
export interface VeoVideoParams {
  prompt: string;
  startImageBase64: string;
  endImageBase64: string;
  referenceImageBase64s?: string[];
  aspectRatio?: string;
  modelKey?: string;
}

export async function generateVeoVideo(params: VeoVideoParams): Promise<ExtensionResponse> {
  return sendMessageToExtension('generateVeoVideo', {
    prompt: params.prompt,
    startImageBase64: params.startImageBase64,
    endImageBase64: params.endImageBase64,
    referenceImageBase64s: params.referenceImageBase64s,
    aspectRatio: params.aspectRatio,
    modelKey: params.modelKey,
  });
}

// Flow 项目 URL 配置
export async function setFlowProjectUrl(flowProjectUrl: string): Promise<ExtensionResponse> {
  return sendMessageToExtension('setFlowProjectUrl', { flowProjectUrl });
}

export async function getFlowProjectUrl(): Promise<ExtensionResponse> {
  return sendMessageToExtension('getFlowProjectUrl');
}

// 发送消息到 Claude
export async function sendToClaude(message: string): Promise<ExtensionResponse> {
  return sendMessageToExtension('sendToClaude', { message });
}

// 发送消息到 ChatGPT
export async function sendToChatGPT(message: string): Promise<ExtensionResponse> {
  return sendMessageToExtension('sendToChatGPT', { message });
}

// 抓取番茄榜单
export async function scanFanqieRank(rankType: string): Promise<ExtensionResponse> {
  return sendMessageToExtension('scanFanqieRank', { rankType });
}

// 获取榜单分类列表
export async function getRankCategories(): Promise<ExtensionResponse> {
  return sendMessageToExtension('getRankCategories');
}

// 获取番茄小说单本信息
export async function getFanqieBookInfo(bookId: string): Promise<ExtensionResponse> {
  return sendMessageToExtension('getFanqieBookInfo', { bookId });
}

// 切换豆包到图像生成模式
export async function switchToDoubaoImageMode(): Promise<ExtensionResponse> {
  return sendMessageToExtension('switchToDoubaoImageMode');
}

// 切换豆包到文字模式
export async function switchToDoubaoTextMode(): Promise<ExtensionResponse> {
  return sendMessageToExtension('switchToDoubaoTextMode');
}

// 发送图像生成请求到豆包
export async function sendToDoubaoImage(prompt: string): Promise<ExtensionResponse> {
  return sendMessageToExtension('sendToDoubaoImage', { message: prompt });
}

// 朱雀 AI 检测
export async function zhuqueDetect(text: string): Promise<ExtensionResponse> {
  return sendMessageToExtension('zhuqueDetect', { text });
}

export async function zhuqueCheckReady(): Promise<ExtensionResponse> {
  return sendMessageToExtension('zhuqueCheckReady');
}

export async function zhuqueOpenPage(): Promise<ExtensionResponse> {
  return sendMessageToExtension('zhuqueOpenPage');
}
