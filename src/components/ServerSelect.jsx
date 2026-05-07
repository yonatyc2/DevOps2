import { usePolling } from '../context/PollingContext'

function serverLabel(s) {
  return s.displayName || s.name || s.host
}

export default function ServerSelect({ value, onChange, id, className, placeholder = 'Select server…' }) {
  const { servers } = usePolling()

  const grouped = {}
  const ungrouped = []

  for (const s of servers) {
    const g = s.group?.trim()
    if (g) {
      if (!grouped[g]) grouped[g] = []
      grouped[g].push(s)
    } else {
      ungrouped.push(s)
    }
  }

  const groupNames = Object.keys(grouped).sort()
  const hasGroups = groupNames.length > 0

  return (
    <select id={id} className={className} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {hasGroups ? (
        <>
          {groupNames.map(g => (
            <optgroup key={g} label={g}>
              {grouped[g].map(s => (
                <option key={s.id} value={s.id}>{serverLabel(s)}</option>
              ))}
            </optgroup>
          ))}
          {ungrouped.length > 0 && (
            <optgroup label="Other">
              {ungrouped.map(s => (
                <option key={s.id} value={s.id}>{serverLabel(s)}</option>
              ))}
            </optgroup>
          )}
        </>
      ) : (
        servers.map(s => (
          <option key={s.id} value={s.id}>{serverLabel(s)}</option>
        ))
      )}
    </select>
  )
}
