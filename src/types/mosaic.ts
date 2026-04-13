export type RGB = {
  r: number
  g: number
  b: number
}

export type ConnectionState =
  | 'demo'
  | 'connecting'
  | 'subscribed'
  | 'polling'
  | 'error'

export type MosaicAsset = {
  photoId: string
  thumbUrl: string
  avgRgb: RGB
  luma: number
  aspectRatio: number
  processedAt: string
  createdAt: string
  status: 'ready' | 'processing' | 'failed'
  sourceImageUrl?: string | null
}

export type MosaicCell = {
  id: string
  x: number
  y: number
  width: number
  height: number
  targetRgb: RGB
  targetLuma: number
  alphaCoverage: number
  occupiedByPhotoId: string | null
}

export type LogoGrid = {
  width: number
  height: number
  columns: number
  rows: number
  cells: MosaicCell[]
}

export type MosaicPlacement = {
  asset: MosaicAsset
  cell: MosaicCell
  slot: number
}
