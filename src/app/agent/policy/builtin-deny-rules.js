const rules = Object.freeze([
  { id: 'destroy_root', expression: /(?:^|[;&|]\s*)rm\s+(?:-[^\s]*[rR][^\s]*[fF]|-[^\s]*[fF][^\s]*[rR])\s+(?:--\s+)?\/(?:\s|$|[*])/i, message: '禁止递归删除根目录。' },
  { id: 'destroy_home', expression: /(?:^|[;&|]\s*)rm\s+(?:-[^\s]*[rR][^\s]*|--recursive)(?:\s+-[^\s]+)*\s+(?:~|\$HOME)(?:\/|\s|$)/i, message: '禁止递归删除用户主目录。' },
  { id: 'destroy_root_long_option', expression: /(?:^|[;&|]\s*)rm\s+--recursive(?:\s+--force)?\s+\/(?:\s|$|[*])/i, message: '禁止递归删除根目录。' },
  { id: 'filesystem_format', expression: /(?:^|[;&|]\s*)(?:mkfs(?:\.[a-z0-9]+)?|mkswap)\s+/i, message: '禁止格式化文件系统或交换设备。' },
  { id: 'raw_device_overwrite', expression: /(?:^|[;&|]\s*)dd\s+[^\n]*(?:of=\/dev\/(?:sd|hd|vd|nvme|mmcblk)|if=\/dev\/(?:zero|random|urandom)[^\n]*of=\/dev\/)/i, message: '禁止覆盖块设备。' },
  { id: 'block_device_redirect', expression: />\s*\/dev\/(?:sd|hd|vd)[a-z]|>\s*\/dev\/nvme\d+n\d+/i, message: '禁止通过重定向覆盖块设备。' },
  { id: 'privileged_delete', expression: /(?:^|[;&|]\s*)(?:sudo|doas)\s+rm\b/i, message: '禁止通过提权直接删除文件。' },
  { id: 'remote_shell_pipe', expression: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh)\b/i, message: '禁止下载内容后直接交给 Shell 执行。' },
  { id: 'fork_bomb', expression: /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;\s*:/, message: '禁止 fork bomb。' },
  { id: 'kernel_overwrite', expression: />\s*\/proc\/sysrq-trigger|\/dev\/mem|\/dev\/kmem/i, message: '禁止直接破坏内核或设备状态。' },
  { id: 'recursive_permission_root', expression: /(?:chmod|chown)\s+[^\n]*-[^\s]*R[^\n]*\s\/(?:\s|$)/i, message: '禁止递归修改根目录权限。' }
])

function matchBuiltinDeny (command) {
  return rules.filter(rule => rule.expression.test(command))
}

module.exports = { rules, matchBuiltinDeny }
