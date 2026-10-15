// Interactive viewer for one STL / 3MF file, streamed from the Library helper
// on this Mac. Loaded lazily so three.js loaders never weigh on the hub.
import { useEffect, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js'

interface Props {
  url: string
  kind: 'stl' | '3mf'
  label: string
}

const MAX_BYTES = 150 * 1024 * 1024

export default function ModelViewer3D({ url, kind, label }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    setState('loading')
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10_000)
    camera.up.set(0, 0, 1) // print-bed convention: Z is up
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9a96, 1.4))
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(-1, -1.4, 2)
    scene.add(key)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true

    const resize = () => {
      const { width, height } = host.getBoundingClientRect()
      renderer.setSize(width, height, false)
      camera.aspect = width / Math.max(height, 1)
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()

    let frame = 0
    const tick = () => {
      controls.update()
      renderer.render(scene, camera)
      frame = requestAnimationFrame(tick)
    }

    const material = new THREE.MeshStandardMaterial({ color: 0x9fb0ad, roughness: 0.62, metalness: 0.05 })

    void (async () => {
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`The Mac helper returned ${res.status}`)
        if (Number(res.headers.get('content-length')) > MAX_BYTES) throw new Error('This file is too large to preview here.')
        const buffer = await res.arrayBuffer()
        if (disposed) return
        let object: THREE.Object3D
        if (kind === 'stl') {
          const geometry = new STLLoader().parse(buffer)
          geometry.computeVertexNormals()
          object = new THREE.Mesh(geometry, material)
        } else {
          object = new ThreeMFLoader().parse(buffer)
          // Keep embedded colours when present; otherwise use the neutral material.
          object.traverse(child => {
            if (child instanceof THREE.Mesh && !child.material) child.material = material
          })
        }
        scene.add(object)
        const box = new THREE.Box3().setFromObject(object)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        const radius = Math.max(size.x, size.y, size.z) || 1
        controls.target.copy(center)
        camera.position.copy(center).add(new THREE.Vector3(radius * 0.8, -radius * 1.1, radius * 0.8))
        camera.near = radius / 100
        camera.far = radius * 100
        camera.updateProjectionMatrix()
        setState('ready')
        tick()
      } catch (err) {
        if (disposed) return
        setMessage(err instanceof Error ? err.message : 'Could not load the model.')
        setState('error')
      }
    })()

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      controls.dispose()
      scene.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose()
          const materials = Array.isArray(child.material) ? child.material : [child.material]
          materials.forEach(m => (m as THREE.Material | undefined)?.dispose())
        }
      })
      material.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [url, kind])

  return (
    <Box role="img" aria-label={`3D view of ${label}. Drag to orbit, scroll to zoom.`} sx={{ position: 'relative', width: '100%', height: '100%', minHeight: 320 }}>
      <Box ref={hostRef} sx={{ position: 'absolute', inset: 0, '& canvas': { display: 'block', width: '100%', height: '100%' } }} />
      {state !== 'ready' && (
        <Typography role="status" color="text.secondary" sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', p: 2, textAlign: 'center' }}>
          {state === 'loading' ? 'Loading the model from your Mac…' : message}
        </Typography>
      )}
    </Box>
  )
}
