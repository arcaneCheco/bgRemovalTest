import * as THREE from 'three';
import * as bodySegmentation from '@tensorflow-models/body-segmentation';
import { Pane } from 'tweakpane';
import { createFFmpeg, fetchFile } from "@ffmpeg/ffmpeg";

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
    pane: Pane;
    constructor() {

        this.render = this.render.bind(this);
        this.startStream = this.startStream.bind(this)
        this.setupBodySegmentation = this.setupBodySegmentation.bind(this)
        this.setMaskTexture = this.setMaskTexture.bind(this)
        this.useRecordScreen = this.useRecordScreen.bind(this)

        this.shouldDrawMask = false;

        this.pane = new Pane();

        this.streamElement = document.querySelector('#streamElement')!;
        this.canvasElement = document.querySelector('#bodySegementation')!;
        const startStreamButton: HTMLButtonElement = document.querySelector('#startStream')!;
        startStreamButton.onclick = this.startStream;

        this.setupBodySegmentation().then(async () => {
            this.init();
            this.onResize();
            this.render();
            this.useRecordScreen();

            setTimeout(() => {
                this.onResize();
            }, 500)
        })


    }

    useRecordScreen() {
        const debug = this.pane.addFolder({ title: 'Screen Recording' })

        debug.addButton({ title: 'Start recording' }).on('click', () => {
            startRecording();
        })

        const ffmpeg = createFFmpeg({
            corePath: "https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js",
            log: true,
        });

        const downloadVideo = async (blob) => {
            var url = URL.createObjectURL(blob);
            console.log(url);
            var a = document.createElement("a");
            a.href = url;
            a.download = "test.webm";
            a.className = "button";
            a.innerText = "click here to download";
            a.click();
        };

        const exportVid = async (blob: Blob) => {
            if (!ffmpeg.isLoaded()) {
                await ffmpeg.load();
                ffmpeg.FS("writeFile", "test.avi", await fetchFile(blob));
                await ffmpeg.run("-i", "test.avi", "test.mp4");
                const data = ffmpeg.FS("readFile", "test.mp4");


                const url = URL.createObjectURL(
                    new Blob([data.buffer], { type: "video/mp4" })
                );

                const a = document.createElement("a");
                a.href = url;
                a.download = "recording.mp4";
                a.click();
            }
        };

        const startRecording = () => {
            const canvas = this.renderer.domElement;
            const chunks: Array<BlobPart> = []; // here we will store our recorded media chunks (Blobs)
            const stream = canvas.captureStream(30); // grab our canvas MediaStream
            const rec = new MediaRecorder(stream); // init the recorder
            // every time the recorder has new data, we will store it in our array
            rec.ondataavailable = (e) => chunks.push(e.data);
            // only when the recorder stops, we construct a complete Blob from all the chunks
            rec.onstop = (e) =>
                exportVid(new Blob(chunks, { type: "video/webm;codecs=h264" }));
            // downloadVideo(new Blob(chunks, { type: "video/webm;codecs=h264" }));
            rec.start();
            setTimeout(() => {
                rec.stop();
            }, 2000); // stop recording in 6s
        };
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
                    maskUv.y = 1. - vUv.y;
                    float mask = texture2D(uMask, maskUv).r;

                    // gl_FragColor.a = mask;
                    gl_FragColor.rgb *= mask;
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

    setMaskTexture(bitmap: ImageBitmap) {
        const texture = new THREE.CanvasTexture(bitmap);
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
        // const segmentationConfig =  {
        //     flipHorizontal: false,
        //     multiSegmentation: false,
        //     segmentBodyParts: true,
        //     segmentationThreshold: STATE.visualization.foregroundThreshold
        //   }
        // segmentation = await segmenter.segmentPeople(camera.video, segmentationConfig);
        const btmap = await result.mask.toCanvasImageSource();

        this.setMaskTexture(btmap);

        const ctx = this.canvasElement.getContext('2d');
        ctx?.clearRect(0, 0, this.streamElement.offsetWidth, this.streamElement.offsetHeight)
        ctx?.drawImage(btmap, 0, 0, this.streamElement.offsetWidth, this.streamElement.offsetHeight)
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

    addBgSource() { }

    async render() {
        this.renderer.render(this.scene, this.camera);
        if (this.shouldDrawMask) {
            await this.drawMask();
        }
        window.requestAnimationFrame(this.render)
    }
}

const start = () => {
    new Experience()
}
start();