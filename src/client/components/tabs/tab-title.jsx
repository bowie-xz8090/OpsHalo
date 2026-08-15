import createName from '../../common/create-title'

export default function tabTitle (props) {
  const { tab } = props
  const title = createName(tab)
  const status = tab.status || ''
  return (
    <span className='tab-title'>
      <span className={'iblock mg1r tab-status-dot ' + status} />
      {title}
    </span>
  )
}
