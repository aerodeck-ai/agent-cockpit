/**
 * CCPaneTile — xterm.js terminal running Claude Code.
 *
 * Connects to the existing /api/terminal-stream endpoint using the session
 * created by /api/cc-pane/spawn. Reuses the same SSE read loop pattern as
 * terminal-workspace.tsx.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

// Dynamic import guard — xterm uses `self` which doesn't exist on SSR
let xtermLoaded = false
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let TerminalCtor: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let FitAddonCtor: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let WebLinksAddonCtor: any

async function ensureXterm() {
  if (xtermLoaded) return
  const [xtermMod, fitMod, linksMod] = await Promise.all([
    import('xterm'),
    import('xterm-addon-fit'),
    import('xterm-addon-web-links'),
  ])
  await import('xterm/css/xterm.css')
  TerminalCtor = xtermMod.Terminal
  FitAddonCtor = fitMod.FitAddon
  WebLinksAddonCtor = linksMod.WebLinksAddon
  xtermLoaded = true
}

const TERMINAL_BG = '#0d0d0d'

type CCPaneTileProps = {
  paneId: string
  sessionId?: string
  accountKey?: string
  workdir?: string
  longContext?: boolean
  onSessionSpawned?: (sessionId: string) => void
}

export function CCPaneTile({
  paneId,
  sessionId: externalSessionId,
  accountKey,
  workdir,
  longContext = false,
  onSessionSpawned,
}: CCPaneTileProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const terminalRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fitAddonRef = useRef<any>(null)
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(
    externalSessionId ?? null,
  )
  const [status, setStatus] = useState<'spawning' | 'connecting' | 'active' | 'error'>(
    'spawning',
  )
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const connectedRef = useRef(false)
  const mountedRef = useRef(true)

  // ── Spawn session if not already provided ─────────────────────────────────
  useEffect(
    function spawnSession() {
      if (externalSessionId) {
        setSessionId(externalSessionId)
        setStatus('connecting')
        return
      }

      async function spawn() {
        try {
          const res = await fetch('/api/cc-pane/spawn', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paneId, workdir, accountKey, longContext }),
          })
          if (!mountedRef.current) return
          if (!res.ok) {
            setStatus('error')
            setErrorMsg('Spawn failed')
            return
          }
          const data = (await res.json()) as { ok: boolean; sessionId?: string }
          if (!data.ok || !data.sessionId) {
            setStatus('error')
            setErrorMsg('No session ID returned')
            return
          }
          setSessionId(data.sessionId)
          setStatus('connecting')
          onSessionSpawned?.(data.sessionId)
        } catch (err) {
          if (!mountedRef.current) return
          setStatus('error')
          setErrorMsg(String(err))
        }
      }

      void spawn()
    },
    // Only spawn once per pane mount — intentionally omitting accountKey/workdir
    // from deps so changing them requires remounting
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paneId],
  )

  // ── Connect xterm + SSE stream once we have a sessionId ───────────────────
  const connectStream = useCallback(
    async function connectStream(sid: string) {
      if (connectedRef.current) return
      const container = containerRef.current
      if (!container) return

      await ensureXterm()
      if (!mountedRef.current) return

      if (!terminalRef.current) {
        const terminal = new TerminalCtor({
          cursorBlink: true,
          fontSize: 12,
          fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
          theme: {
            background: TERMINAL_BG,
            foreground: '#e6e6e6',
            cursor: '#ea580c',
            selectionBackground: '#2b2b2b',
          },
        })
        const fitAddon = new FitAddonCtor()
        const webLinks = new WebLinksAddonCtor()
        terminal.loadAddon(fitAddon)
        terminal.loadAddon(webLinks)
        terminal.open(container)
        fitAddon.fit()

        terminal.onData(function sendData(data: string) {
          fetch('/api/terminal-input', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: sid, data }),
          }).catch(() => undefined)
        })

        terminalRef.current = terminal
        fitAddonRef.current = fitAddon
      }

      connectedRef.current = true
      setStatus('active')

      const res = await fetch('/api/terminal-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sid,
          cols: terminalRef.current?.cols ?? 220,
          rows: terminalRef.current?.rows ?? 50,
        }),
      }).catch(() => null)

      if (!res || !res.ok || !res.body) {
        connectedRef.current = false
        setStatus('error')
        setErrorMsg('Stream connect failed')
        return
      }

      const reader = res.body.getReader()
      readerRef.current = reader
      const decoder = new TextDecoder()
      let buf = ''
      let writeBuf = ''
      let flushTimer: ReturnType<typeof setTimeout> | null = null
      const FLUSH_MS = 80

      function flushWrites() {
        flushTimer = null
        const terminal = terminalRef.current
        if (writeBuf && terminal) {
          const chunk = writeBuf
          writeBuf = ''
          terminal.write(chunk)
        }
      }

      function queueWrite(data: string) {
        writeBuf += data
        if (writeBuf.length > 8192) writeBuf = writeBuf.slice(-8192)
        if (!flushTimer) flushTimer = setTimeout(flushWrites, FLUSH_MS)
      }

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      while (true) {
        const result = await reader.read().catch(() => ({ done: true, value: undefined }))
        if (result.done) break
        if (!result.value) continue

        buf += decoder.decode(result.value, { stream: true })
        const blocks = buf.split('\n\n')
        buf = blocks.pop() ?? ''

        for (const block of blocks) {
          if (!block.trim()) continue
          const lines = block.split('\n')
          let eventName = ''
          let eventData = ''
          for (const line of lines) {
            if (line.startsWith('event: ')) eventName = line.slice(7).trim()
            else if (line.startsWith('data: ')) eventData += line.slice(6)
            else if (line.startsWith('data:')) eventData += line.slice(5)
          }
          if (!eventName || eventName === 'ping') continue
          if (eventName === 'data' && eventData) {
            const payload = JSON.parse(eventData) as { data?: string }
            if (typeof payload.data === 'string') queueWrite(payload.data)
          } else if (eventName === 'exit') {
            terminalRef.current?.writeln('\r\n[process exited]\r\n')
          } else if (eventName === 'error') {
            terminalRef.current?.writeln('\r\n[terminal error]\r\n')
          }
        }
      }

      if (flushTimer) clearTimeout(flushTimer)
      flushWrites()
      connectedRef.current = false
    },
    [],
  )

  useEffect(
    function startStreamWhenReady() {
      if (!sessionId) return
      void connectStream(sessionId)
    },
    [sessionId, connectStream],
  )

  // ── Resize on layout change ───────────────────────────────────────────────
  useEffect(
    function fitOnResize() {
      function refit() {
        try {
          fitAddonRef.current?.fit()
          if (terminalRef.current && sessionId) {
            fetch('/api/terminal-resize', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sessionId,
                cols: terminalRef.current.cols,
                rows: terminalRef.current.rows,
              }),
            }).catch(() => undefined)
          }
        } catch {
          // ignore
        }
      }
      window.addEventListener('resize', refit)
      return () => window.removeEventListener('resize', refit)
    },
    [sessionId],
  )

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(
    function cleanup() {
      mountedRef.current = true
      return () => {
        mountedRef.current = false
        readerRef.current?.cancel().catch(() => undefined)
        terminalRef.current?.dispose()
        terminalRef.current = null
        fitAddonRef.current = null
        // Graceful detach
        if (sessionId) {
          fetch('/api/cc-pane/detach', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId }),
          }).catch(() => undefined)
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  if (status === 'error') {
    return (
      <div className="flex h-full items-center justify-center bg-primary-50 p-4">
        <p className="text-xs text-red-400">
          {errorMsg ?? 'Terminal error'}
        </p>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full" style={{ backgroundColor: TERMINAL_BG }}>
      {(status === 'spawning' || status === 'connecting') ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs text-primary-400">
            {status === 'spawning' ? 'Spawning Claude…' : 'Connecting…'}
          </span>
        </div>
      ) : null}
      <div
        ref={containerRef}
        className={cn(
          'h-full w-full',
          status !== 'active' ? 'opacity-0' : 'opacity-100',
        )}
        onClick={() => terminalRef.current?.focus()}
        style={{ backgroundColor: TERMINAL_BG }}
      />
    </div>
  )
}
