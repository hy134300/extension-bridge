import React, { useEffect, useState, useCallback } from 'react'
import {
  sendToDoubao,
  sendToDoubaoImage,
  sendToGemini,
  sendToDeepSeek,
} from './extension-client'

export function cleanBridgeResponse(text: string): string {
  if (!text) return ''
  let s = text.trim()
  s = s.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '')
  return s.trim()
}

// ⚡ 全局防重 Set 与队列，彻底杜绝重入与中断
const globalHandledIds = new Set<string>()
const globalSendingIds = new Set<string>()
const requestQueue: any[] = []
let isProcessingQueue = false

export function BridgeGlobalOrchestrator() {
  const [logs, setLogs] = useState<Array<{ ts: number; text: string; type: 'info' | 'success' | 'error' }>>([])
  const [isOpen, setIsOpen] = useState(false)
  const [targetEngine, setTargetEngine] = useState<'doubao' | 'gemini' | 'deepseek'>('gemini')
  const [currentRequest, setCurrentRequest] = useState<any>(null)

  const addLog = useCallback((text: string, type: 'info' | 'success' | 'error' = 'info') => {
    setLogs((prev) => [...prev.slice(-49), { ts: Date.now(), text, type }])
  }, [])

  const processQueue = useCallback(async () => {
    if (isProcessingQueue) return
    isProcessingQueue = true

    while (requestQueue.length > 0) {
      const req = requestQueue.shift()
      if (!req || !req.requestId || !req.sessionId) continue
      if (globalSendingIds.has(req.requestId)) continue
      globalSendingIds.add(req.requestId)

      setCurrentRequest(req)
      setIsOpen(true)

      const fullPrompt = (req.messages || [])
        .map((m: any) => {
          if (m.role === 'system') return `【系统提示】\n${m.content}`
          if (m.role === 'user') return `【用户输入】\n${m.content}`
          return m.content
        })
        .join('\n\n---\n\n')

      const isVideoRequest = fullPrompt.includes('【请为以下提示词生成镜头视频】')
      const isImageRequest = fullPrompt.includes('【请为以下提示词生成精美图片】') || fullPrompt.includes('【请根据以下描述修改生成图片】')

      const reqModel = String(req.model || '').toLowerCase()
      const effectiveEngine = reqModel.includes('doubao')
        ? 'doubao'
        : reqModel.includes('deepseek')
        ? 'deepseek'
        : reqModel.includes('gemini')
        ? 'gemini'
        : targetEngine

      const engineName = effectiveEngine === 'doubao' ? '豆包网页' : effectiveEngine === 'deepseek' ? 'DeepSeek' : 'Gemini'
      const actionDesc = isVideoRequest ? '生成镜头视频' : isImageRequest ? '绘制图片' : '执行推导'
      addLog(`→ 正在全自动呼叫【${engineName}扩展】${actionDesc}... (#${req.requestId.slice(0, 8)})`, 'info')

      try {
        let res
        if (effectiveEngine === 'doubao') {
          res = isImageRequest ? await sendToDoubaoImage(fullPrompt) : await sendToDoubao(fullPrompt)
        } else if (effectiveEngine === 'deepseek') {
          res = await sendToDeepSeek(fullPrompt)
        } else {
          res = await sendToGemini(fullPrompt, req.files)
        }

        if (res.success && res.content) {
          const cleanedContent = cleanBridgeResponse(res.content)
          const isRefusal = /sorry|can't|cannot|safety|policy|违规|无法处理|无法生成|不支持|敏感/i.test(cleanedContent)

          if (isRefusal && (isVideoRequest || isImageRequest)) {
            addLog(`❌ AI网页端拦截拒答（提示词安全/违规）`, 'error')
            await fetch(`/api/gemini-bridge/${req.sessionId}/resolve/${req.requestId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ error: `提示词涉及风控或拒绝处理: ${cleanedContent.slice(0, 80)}` }),
            })
          } else {
            addLog(`✓ ${engineName}${actionDesc}完成，正在回传后台...`, 'success')
            await fetch(`/api/gemini-bridge/${req.sessionId}/resolve/${req.requestId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: cleanedContent }),
            })
            addLog(`✓ 成功回传！阶段完成 (#${req.requestId.slice(0, 8)})`, 'success')
          }
        } else {
          addLog(`❌ 扩展响应异常: ${res.error || '未返回内容'}`, 'error')
          await fetch(`/api/gemini-bridge/${req.sessionId}/resolve/${req.requestId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: res.error || '扩展响应失败' }),
          })
        }
      } catch (err: any) {
        addLog(`❌ 处理过程出错: ${err?.message}`, 'error')
        await fetch(`/api/gemini-bridge/${req.sessionId}/resolve/${req.requestId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: err?.message || '内部处理异常' }),
        }).catch(() => null)
      }
    }

    isProcessingQueue = false
    setCurrentRequest(null)
  }, [addLog, targetEngine])

  // 1. 订阅 Waoowaoo 原生 SSE 广播
  useEffect(() => {
    const sseUrl = '/api/gemini-bridge/events'
    const es = new EventSource(sseUrl)

    es.addEventListener('gemini:llm-request', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        if (!data || !data.requestId) return
        if (globalHandledIds.has(data.requestId)) return

        globalHandledIds.add(data.requestId)
        requestQueue.push(data)
        addLog(`← 收到任务请求 #${data.requestId.slice(0, 8)}，排队数: ${requestQueue.length}`, 'info')
        void processQueue()
      } catch (err) {
        // ignore
      }
    })

    return () => {
      es.close()
    }
  }, [addLog, processQueue])

  if (!isOpen && !currentRequest && requestQueue.length === 0) return null

  return (
    <div className="fixed bottom-6 right-6 z-50 w-96 rounded-2xl border border-blue-500/30 bg-slate-900/95 p-4 text-white shadow-2xl backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500"></span>
          </span>
          <h4 className="font-semibold text-sm text-slate-100">Waoowaoo 网页 AI 扩展桥接</h4>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={targetEngine}
            onChange={(e) => setTargetEngine(e.target.value as any)}
            className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300 focus:outline-none"
          >
            <option value="gemini">Gemini 网页</option>
            <option value="doubao">豆包网页</option>
            <option value="deepseek">DeepSeek 网页</option>
          </select>
          <button
            onClick={() => setIsOpen(false)}
            className="text-slate-400 hover:text-white text-xs px-1"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="mt-3 max-h-48 overflow-y-auto space-y-1.5 text-xs text-slate-300 font-mono">
        {logs.map((log, idx) => (
          <div
            key={idx}
            className={`p-1.5 rounded ${
              log.type === 'success'
                ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/40'
                : log.type === 'error'
                ? 'bg-rose-950/60 text-rose-300 border border-rose-800/40'
                : 'bg-slate-800/50'
            }`}
          >
            {log.text}
          </div>
        ))}
      </div>
    </div>
  )
}
