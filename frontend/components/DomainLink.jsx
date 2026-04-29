function domainHref(domain) {
  const value = String(domain || '').trim()
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  return `https://${value}`
}

export default function DomainLink({ domain, className = '', children }) {
  const href = domainHref(domain)
  if (!href) return null
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`text-accent hover:text-blue-400 hover:underline break-all ${className}`}
    >
      {children || domain}
    </a>
  )
}
