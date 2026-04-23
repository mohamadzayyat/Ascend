import { useEffect, useMemo, useState } from 'react'
import { apiClient } from '@/lib/api'

function normalizeDomain(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .split(':')[0]
    .replace(/\.$/, '')
    .toLowerCase()
}

export default function DomainDnsCheck({ domain, enabled = true, onStatus }) {
  const cleanDomain = useMemo(() => normalizeDomain(domain), [domain])
  const [state, setState] = useState({ status: 'idle', result: null, error: '' })

  useEffect(() => {
    if (!enabled || !cleanDomain) {
      setState({ status: 'idle', result: null, error: '' })
      onStatus?.('idle')
      return
    }

    let cancelled = false
    setState({ status: 'checking', result: null, error: '' })
    onStatus?.('checking')

    const timer = setTimeout(async () => {
      try {
        const res = await apiClient.checkDomainDns(cleanDomain)
        if (cancelled) return
        const next = res.data?.ok ? 'ok' : 'error'
        setState({ status: next, result: res.data, error: res.data?.error || '' })
        onStatus?.(next, res.data)
      } catch (err) {
        if (cancelled) return
        const data = err.response?.data
        setState({
          status: 'error',
          result: data?.dns || null,
          error: data?.error || err.message || 'Could not check DNS',
        })
        onStatus?.('error', data?.dns || null)
      }
    }, 500)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [cleanDomain, enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled || !cleanDomain) return null

  if (state.status === 'checking') {
    return <p className="text-xs text-yellow-400 mt-2">Checking DNS for {cleanDomain}...</p>
  }

  if (state.status === 'ok') {
    const matches = state.result?.matches?.join(', ')
    return (
      <p className="text-xs text-green-400 mt-2">
        DNS is pointed to this server{matches ? ` (${matches})` : ''}.
      </p>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="text-xs text-red-400 mt-2 space-y-1">
        <p>{state.error || 'DNS does not point to this server.'}</p>
        {state.result?.server_ips?.length > 0 && (
          <p className="text-gray-500">Expected: {state.result.server_ips.join(', ')}</p>
        )}
        {state.result?.domain_ips?.length > 0 && (
          <p className="text-gray-500">Current DNS: {state.result.domain_ips.join(', ')}</p>
        )}
      </div>
    )
  }

  return null
}
