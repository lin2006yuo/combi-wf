import { z } from 'zod'
import { NodeRegistry } from './registry'
import type { NodeDefinition } from './types'

const imageParams = z.object({
  prompt: z.string().min(1, '请输入提示词'),
  model: z.enum(['flux-1.1-pro', 'sdxl']),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']),
  seed: z.number().int().min(0).optional(),
})

export const imageGenNode: NodeDefinition<typeof imageParams> = {
  type: 'image.gen',
  title: '图片生成',
  category: 'image',
  description: '用文生图模型生成一张图片，输出 image 资产。',
  inputs: [],
  outputs: [{ id: 'image', label: '图片', type: 'image' }],
  params: imageParams,
  defaults: {
    prompt: '雨夜霓虹下的城市街道，电影感，35mm',
    model: 'flux-1.1-pro',
    aspectRatio: '16:9',
  },
  ui: {
    accent: '#8b5cf6',
    icon: 'image',
    fields: [
      {
        key: 'prompt',
        label: '提示词',
        kind: 'textarea',
        placeholder: '描述你想要的画面…',
      },
      {
        key: 'model',
        label: '模型',
        kind: 'select',
        options: [
          { value: 'flux-1.1-pro', label: 'FLUX 1.1 Pro' },
          { value: 'sdxl', label: 'SDXL' },
        ],
      },
      {
        key: 'aspectRatio',
        label: '画幅',
        kind: 'select',
        options: [
          { value: '16:9', label: '16:9 横屏' },
          { value: '9:16', label: '9:16 竖屏' },
          { value: '1:1', label: '1:1 方形' },
        ],
      },
      { key: 'seed', label: '种子', kind: 'number', min: 0, step: 1, help: '留空则随机' },
    ],
  },
}

const videoParams = z.object({
  prompt: z.string().min(1, '请输入提示词'),
  model: z.enum(['kling-2.1', 'runway-gen4']),
  duration: z.union([z.literal(5), z.literal(10)]),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']),
  motion: z.number().min(1).max(10),
})

export const videoGenNode: NodeDefinition<typeof videoParams> = {
  type: 'video.gen',
  title: '视频生成',
  category: 'video',
  description: '根据提示词生成短视频。可接一张图片作为首帧，输出 video 资产。',
  inputs: [{ id: 'firstFrame', label: '首帧', type: 'image', required: false }],
  outputs: [{ id: 'video', label: '视频', type: 'video' }],
  params: videoParams,
  defaults: {
    prompt: '镜头缓慢推进，雨滴划过霓虹灯牌，赛博朋克氛围',
    model: 'kling-2.1',
    duration: 5,
    aspectRatio: '16:9',
    motion: 6,
  },
  ui: {
    accent: '#06b6d4',
    icon: 'video',
    fields: [
      {
        key: 'prompt',
        label: '提示词',
        kind: 'textarea',
        placeholder: '描述镜头运动、主体、氛围…',
      },
      {
        key: 'model',
        label: '模型',
        kind: 'select',
        options: [
          { value: 'kling-2.1', label: 'Kling 2.1' },
          { value: 'runway-gen4', label: 'Runway Gen-4' },
        ],
      },
      {
        key: 'duration',
        label: '时长',
        kind: 'select',
        options: [
          { value: '5', label: '5 秒' },
          { value: '10', label: '10 秒' },
        ],
      },
      {
        key: 'aspectRatio',
        label: '画幅',
        kind: 'select',
        options: [
          { value: '16:9', label: '16:9 横屏' },
          { value: '9:16', label: '9:16 竖屏' },
          { value: '1:1', label: '1:1 方形' },
        ],
      },
      { key: 'motion', label: '运动强度', kind: 'number', min: 1, max: 10, step: 1 },
    ],
  },
}

const composeParams = z.object({
  transition: z.enum(['cut', 'fade', 'dissolve']),
  resolution: z.enum(['1080p', '4k']),
  bgmVolume: z.number().min(0).max(100),
  mute: z.boolean(),
})

export const composeNode: NodeDefinition<typeof composeParams> = {
  type: 'compose',
  title: '组合输出',
  category: 'compose',
  description:
    '按连线顺序把多段视频拼接为最终成片，可选背景音乐。clips 端口可接多条 video 边。',
  inputs: [
    {
      id: 'clips',
      label: '片段',
      type: 'video',
      required: true,
      multi: true,
      description: '按连线顺序拼接',
    },
    { id: 'music', label: '音乐', type: 'audio', required: false },
  ],
  outputs: [{ id: 'video', label: '成片', type: 'video' }],
  params: composeParams,
  defaults: {
    transition: 'fade',
    resolution: '1080p',
    bgmVolume: 60,
    mute: false,
  },
  ui: {
    accent: '#f59e0b',
    icon: 'layers',
    fields: [
      {
        key: 'transition',
        label: '转场',
        kind: 'select',
        options: [
          { value: 'cut', label: '硬切' },
          { value: 'fade', label: '淡入淡出' },
          { value: 'dissolve', label: '叠化' },
        ],
      },
      {
        key: 'resolution',
        label: '分辨率',
        kind: 'select',
        options: [
          { value: '1080p', label: '1080p' },
          { value: '4k', label: '4K' },
        ],
      },
      { key: 'bgmVolume', label: 'BGM 音量', kind: 'number', min: 0, max: 100, step: 5 },
      { key: 'mute', label: '静音', kind: 'switch' },
    ],
  },
}

export function createDefaultRegistry(): NodeRegistry {
  return new NodeRegistry()
    .register(imageGenNode)
    .register(videoGenNode)
    .register(composeNode)
}
