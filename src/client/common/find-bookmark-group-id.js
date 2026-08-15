/**
 * find bookmark group id for bookmark id
 */

import {
  defaultBookmarkGroupId
} from './constants'

export default (bookmarkGroups = [], id) => {
  const list = Array.isArray(bookmarkGroups) ? bookmarkGroups : []
  const obj = list.find(bg => {
    if (!bg || typeof bg !== 'object') {
      return false
    }
    return Array.isArray(bg.bookmarkIds) && bg.bookmarkIds.includes(id)
  })
  return obj ? obj.id : defaultBookmarkGroupId
}
