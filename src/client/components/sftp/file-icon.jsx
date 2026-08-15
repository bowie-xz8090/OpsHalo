/**
 * file/folder icon by ext or name
 */

import { getIconForFile, getIconForFolder } from 'electerm-icons'

function resolveIconSrc (name) {
  const fallback = '/node_modules/electerm-icons/icons/'
  let base = window.pre?.extIconPath || fallback
  // 开发态旧主进程可能写死 http://127.0.0.1:5578/...，按当前页面 origin 重写
  const localAbs = base.match(/^(https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?)(\/.*)?$/i)
  if (localAbs) {
    base = localAbs[2] || fallback
  }
  if (/^https?:\/\//i.test(base) || base.startsWith('file:')) {
    return base + name
  }
  const prefix = base.startsWith('/') ? base : `/${base}`
  return `${window.location.origin}${prefix}${name}`
}

export default function FileIcon ({ file, ...extra }) {
  const name = file.isDirectory
    ? getIconForFolder(file.name)
    : getIconForFile(file.name)
  return (
    <img
      src={resolveIconSrc(name)}
      height={16}
      alt=''
      onError={(e) => {
        e.currentTarget.style.visibility = 'hidden'
      }}
      {...extra}
    />
  )
}
