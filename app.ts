import * as THREE from 'three';
// import '@tensorflow/tfjs-backend-webgl';
// import * as mpPose from '@mediapipe/pose';
// import * as mpSelfieSegmentation from '@mediapipe/selfie_segmentation';
// import * as tfjsWasm from '@tensorflow/tfjs-backend-wasm';
// import * as tf from '@tensorflow/tfjs-core';
// import * as bodySegmentation from '@tensorflow-models/body-segmentation';
// import '@tensorflow/tfjs-backend-core';
// import '@tensorflow/tfjs-backend-webgl';
import * as bodySegmentation from '@tensorflow-models/body-segmentation';

export function fit(type, outer, inner) {
    let outerAspect = outer.width / outer.height;
    let innerAspect = inner.width / inner.height;
    let outerWider = outerAspect > innerAspect;

    let width = outer.width;
    let height = outer.height;

    if ((type === 'cover' && outerWider) || (type === 'contain' && !outerWider)) {
        height = width / innerAspect;
    } else if (type === 'cover' || type === 'contain') {
        width = height * innerAspect;
    }

    return { width, height };
}

class Experience {
    width: number;
    height: number;
    renderer: THREE.WebGLRenderer;
    camera: THREE.OrthographicCamera;
    scene: THREE.Scene;
    container: HTMLDivElement;
    streamElement: HTMLVideoElement;
    canvasElement: HTMLCanvasElement;
    segmenter: bodySegmentation.BodySegmenter;
    shouldDrawMask: boolean;
    cameraMaterial: THREE.ShaderMaterial;
    constructor() {

        this.render = this.render.bind(this);
        this.startStream = this.startStream.bind(this)
        this.setupBodySegmentation = this.setupBodySegmentation.bind(this)
        this.setMaskTexture = this.setMaskTexture.bind(this)

        this.shouldDrawMask = false;

        this.streamElement = document.querySelector('#streamElement')!;
        this.canvasElement = document.querySelector('#bodySegementation')!;
        const startStreamButton: HTMLButtonElement = document.querySelector('#startStream')!;
        startStreamButton.onclick = this.startStream;

        this.setupBodySegmentation().then(async () => {
            this.init();
            this.onResize();
            this.render();

            setTimeout(() => {
                this.onResize();
            }, 500)
        })


    }

    init() {
        this.container = document.querySelector('#three')!;
        this.width = this.container.offsetWidth;
        this.height = this.container.offsetHeight;
        this.renderer = new THREE.WebGLRenderer({
            antialias: false,
            depth: false,
            alpha: false,
            preserveDrawingBuffer: true
        })
        this.camera = new THREE.OrthographicCamera(this.width / - 2, this.width / 2, this.height / 2, this.height / - 2, 0, 10);
        this.camera.position.z = 1;
        this.scene = new THREE.Scene();
        this.container.appendChild(this.renderer.domElement);
        this.renderer.setSize(this.width, this.height);
    }

    addObj() {
        // const geo = new THREE.PlaneGeometry(this.width, this.height);
        const cameraFrameSize = fit('cover', { width: this.width, height: this.height }, {
            width: this.streamElement.offsetWidth,
            height: this.streamElement.offsetHeight
        });
        const cameraGeo = new THREE.PlaneGeometry(cameraFrameSize.width, cameraFrameSize.height);
        const videoTexture = new THREE.VideoTexture(this.streamElement);
        this.cameraMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uMap: { value: videoTexture },
                uMask: { value: null }
            },
            fragmentShader: `
                uniform sampler2D uMap;
                uniform sampler2D uMask;
                varying vec2 vUv;
                void main() {
                    vec4 img = texture2D(uMap, vUv);
                    gl_FragColor = img;
                    vec2 maskUv = vUv;
                    // maskUv.x *= -1.;
                    maskUv.y = 1. - vUv.y;
                    float mask = texture2D(uMask, maskUv).r;
                    gl_FragColor.a = mask;
                    // gl_FragColor *= mask.r;
                }
            `,
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
                    vUv = uv;
                }
            `
        });
        const cameraMesh = new THREE.Mesh(cameraGeo, this.cameraMaterial);
        cameraMesh.scale.x = -1;
        this.scene.add(cameraMesh);
    }

    // createFlippedBitmap(Bitmap source, boolean xFlip, boolean yFlip) {
    //     Matrix matrix = new Matrix();
    //     matrix.postScale(xFlip ? -1 : 1, yFlip ? -1 : 1, source.getWidth() / 2f, source.getHeight() / 2f);
    //     return Bitmap.createBitmap(source, 0, 0, source.getWidth(), source.getHeight(), matrix, true);
    // }

    setMaskTexture(bitmap: ImageBitmap) {
        const texture = new THREE.CanvasTexture(bitmap);
        texture.wrapS = THREE.RepeatWrapping;
        texture.repeat.x = - 1;
        // texture.flipY = true;
        this.cameraMaterial.uniforms.uMask.value = texture;
    }

    async setupBodySegmentation() {
        const model = bodySegmentation.SupportedModels.MediaPipeSelfieSegmentation;
        const segmenterConfig = {
            runtime: 'mediapipe', // or 'tfjs'
            // solutionPath: '/Users/sergio/Desktop/repositories/webARPortal/node_modules/@mediapipe/selfie_segmentation',
            solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation',
            modelType: 'general'
        }
        this.segmenter = await bodySegmentation.createSegmenter(model, segmenterConfig);
    }

    async drawMask() {

        const image = this.streamElement;
        const [result] = await this.segmenter.segmentPeople(image);
        // segmentation = await segmenter.segmentPeople(camera.video, {
        //     flipHorizontal: false,
        //     multiSegmentation: false,
        //     segmentBodyParts: true,
        //     segmentationThreshold: STATE.visualization.foregroundThreshold
        //   });
        const btmap = await result.mask.toCanvasImageSource();
        // console.log({ btmap })

        this.setMaskTexture(btmap);
        // console.log({ result })
        // console.log({ mask: btmap })
        const ctx = this.canvasElement.getContext('2d');
        ctx?.clearRect(0, 0, this.streamElement.offsetWidth, this.streamElement.offsetHeight)
        ctx?.drawImage(btmap, 0, 0, this.streamElement.offsetWidth, this.streamElement.offsetHeight)

        // const gl = window.exposedContext;
        // console.log({ gl })
    }

    onResize() {
        this.width = this.container.offsetWidth;
        this.height = this.container.offsetHeight;
        this.renderer.setSize(this.width, this.height);
    }

    async startStream() {
        console.log('HELLO')
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        this.streamElement.srcObject = stream;

        await new Promise(resolve => {
            this.streamElement.onloadedmetadata = resolve;
        });

        this.addObj();

        this.shouldDrawMask = true;
    }

    render() {
        this.renderer.render(this.scene, this.camera);
        if (this.shouldDrawMask) {
            this.drawMask();
        }
        window.requestAnimationFrame(this.render)
    }
}

const start = () => {
    new Experience()
}
start();