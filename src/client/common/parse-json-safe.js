/**
 * safe parse json — never throws; corrupt values return null
 */
export default str => {
  if (str === '' || str == null) {
    return null
  }
  if (typeof str !== 'string') {
    return str
  }
  try {
    return JSON.parse(str)
  } catch (e) {
    // Avoid noisy stack dumps for expected corrupt/legacy localStorage
    console.warn('JSON.parse skipped for invalid value')
    return null
  }
}
