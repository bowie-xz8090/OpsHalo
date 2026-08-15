import { useEffect, useState } from 'react'
import { Button, Drawer, Spin } from 'antd'

export default function AgentEvidenceDetail ({ taskId, evidenceRef, open, onClose, load, onDelete }) {
  const [page, setPage] = useState(null)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setPage(null)
    setContent('')
    if (open && evidenceRef) loadPage(0)
  }, [open, evidenceRef])

  async function loadPage (offset) {
    setLoading(true)
    try {
      const next = await load({ taskId, evidenceRef, offset, limit: 64 * 1024 })
      setPage(next)
      setContent(previous => offset === 0 ? next.content : previous + next.content)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Drawer title='清洗后的本地证据' placement='bottom' height='70%' open={open} onClose={onClose} getContainer={false}>
      {loading && !page && <Spin />}
      {page && (
        <>
          <dl className='agent-evidence-meta'>
            <dt>引用</dt><dd>{evidenceRef}</dd>
            <dt>类型</dt><dd>{page.metadata.kind} · {page.metadata.mediaType}</dd>
            <dt>哈希</dt><dd>{page.metadata.sha256}</dd>
            <dt>脱敏</dt><dd>{page.metadata.redactionSummary.count} 处</dd>
            <dt>过期</dt><dd>{new Date(page.metadata.expiresAt).toLocaleString()}</dd>
            <dt>大小</dt><dd>{page.totalBytes} bytes</dd>
          </dl>
          <pre className='agent-evidence-content'>{content}</pre>
          {page.nextOffset !== null && <Button loading={loading} onClick={() => loadPage(page.nextOffset)}>加载下一页</Button>}
          <Button danger onClick={() => onDelete({ taskId, evidenceRef })}>删除这项证据</Button>
        </>
      )}
    </Drawer>
  )
}
