/**
 * Common submit buttons for connection forms (mini edition)
 */
import React from 'react'
import { Button, Form } from 'antd'
import { tailFormItemLayout } from '../../../common/form-layout'

const FormItem = Form.Item

export default function SubmitButtons ({
  onConnect,
  onSaveAndConnect,
  onTestConnection
}) {
  return (
    <FormItem {...tailFormItemLayout}>
      <p>
        <Button type='dashed' onClick={onConnect} className='mg1r mg1b'>
          直接连接
        </Button>
        <Button type='primary' onClick={onSaveAndConnect} className='mg1r mg1b'>
          保存并连接
        </Button>
        <Button type='dashed' onClick={onTestConnection} className='mg1r mg1b'>
          测试连接
        </Button>
      </p>
    </FormItem>
  )
}
