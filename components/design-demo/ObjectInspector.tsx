import { DemoIcon } from './DemoIcon'
import type { DemoEntity } from './types'
import styles from './design-demo.module.css'

interface ObjectInspectorProps {
  entity: DemoEntity | null
  dirty: boolean
  onChange: (field: 'category' | 'pose' | 'action' | 'occlusion', value: string | number) => void
  onSave: () => void
  onClear: () => void
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className={styles.field}><span>{label}</span>{children}</label>
}

export function ObjectInspector({ entity, dirty, onChange, onSave, onClear }: ObjectInspectorProps) {
  return (
    <aside className={styles.inspector}>
      <div className={styles.inspectorHeader}>
        <div>
          <span className={styles.panelKicker}>属性面板</span>
          <strong>当前对象</strong>
        </div>
        <button className={styles.smallIconButton} type="button" aria-label="更多对象操作"><DemoIcon name="more" /></button>
      </div>

      {!entity ? (
        <div className={styles.inspectorEmpty}>
          <span><DemoIcon name="box" /></span>
          <strong>未选择标注对象</strong>
          <p>在视频画面或人物轨道中选择一个对象，即可编辑其属性。</p>
        </div>
      ) : (
        <>
          <div className={styles.entityIdentity}>
            <span className={`${styles.entitySwatch} ${styles[`swatch${entity.color}`]}`} />
            <div>
              <strong>{entity.displayName}</strong>
              <span>{entity.label} · {entity.type === 'person' ? '人物' : '实体'}</span>
            </div>
            <span className={styles.confidence}>{Math.round(entity.confidence * 100)}% 置信度</span>
          </div>

          <div className={styles.inspectorSection}>
            <div className={styles.inspectorSectionTitle}><strong>基础属性</strong><span>{entity.attributes.source}</span></div>
            <Field label="分类">
              <select value={entity.attributes.category} onChange={event => onChange('category', event.target.value)}>
                <option>成年行人</option><option>儿童</option><option>骑行者</option><option>随身物品</option>
              </select>
            </Field>
            {entity.type === 'person' ? (
              <div className={styles.fieldGrid}>
                <Field label="姿态">
                  <select value={entity.attributes.pose} onChange={event => onChange('pose', event.target.value)}>
                    <option>行走</option><option>站立</option><option>坐姿</option><option>奔跑</option>
                  </select>
                </Field>
                <Field label="遮挡率">
                  <div className={styles.unitInput}>
                    <input type="number" min={0} max={100} value={Math.round(entity.attributes.occlusion * 100)} onChange={event => onChange('occlusion', Number(event.target.value) / 100)} />
                    <span>%</span>
                  </div>
                </Field>
              </div>
            ) : null}
            <Field label="当前行为">
              <input value={entity.attributes.action || ''} placeholder="添加行为标签" onChange={event => onChange('action', event.target.value)} />
            </Field>
          </div>

          <div className={styles.inspectorSection}>
            <div className={styles.inspectorSectionTitle}><strong>边界框</strong><span>1920 × 1080</span></div>
            <div className={styles.bboxGrid}>
              <span><small>X</small><strong>{Math.round(entity.bbox.x * 19.2)}</strong></span>
              <span><small>Y</small><strong>{Math.round(entity.bbox.y * 10.8)}</strong></span>
              <span><small>W</small><strong>{Math.round(entity.bbox.width * 19.2)}</strong></span>
              <span><small>H</small><strong>{Math.round(entity.bbox.height * 10.8)}</strong></span>
            </div>
          </div>

          <div className={styles.validationCard}>
            <span className={styles.validationIcon}><DemoIcon name="check" /></span>
            <div><strong>对象检查通过</strong><p>边界框完整，关键属性已填写。</p></div>
          </div>

          <div className={styles.inspectorEmptyMini}>
            <span><DemoIcon name="layers" /></span>
            <div><strong>本帧暂无 OCR 内容</strong><p>切换到含文字的关键帧后自动显示。</p></div>
          </div>

          <div className={styles.inspectorActions}>
            <button className={styles.ghostButton} type="button" onClick={onClear}>取消选择</button>
            <button className={styles.primaryButton} type="button" onClick={onSave} disabled={!dirty}>保存对象</button>
          </div>
        </>
      )}
    </aside>
  )
}
