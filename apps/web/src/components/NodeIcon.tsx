import { Image as ImageIcon, Layers, Sparkles, Video, type LucideIcon } from 'lucide-react'

const icons: Record<string, LucideIcon> = {
  image: ImageIcon,
  video: Video,
  layers: Layers,
  sparkles: Sparkles,
}

export function NodeIcon({ name, size = 16 }: { name: string; size?: number }) {
  const Icon = icons[name] ?? Sparkles
  return <Icon size={size} />
}
