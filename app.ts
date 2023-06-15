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
    foregroundThreshold: number;
    constructor() {

        this.render = this.render.bind(this);
        this.startStream = this.startStream.bind(this)
        this.setupBodySegmentation = this.setupBodySegmentation.bind(this)
        this.setMaskTexture = this.setMaskTexture.bind(this)
        this.useRecordScreen = this.useRecordScreen.bind(this)
        this.addBgSrc = this.addBgSrc.bind(this)

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
            this.addBgSrc()

            setTimeout(() => {
                this.onResize();
            }, 500)
        })
    }

    addBgSrc() {
        const debug = this.pane.addFolder({ title: 'Background' })

        debug.addButton({ title: 'add background' }).on('click', () => {
            const video = document.createElement('video');
            video.classList.add('src')
            video.src = 'assets/bg.mp4';
            video.autoplay = true;
            video.playsInline = true;
            video.muted = true;
            video.loop = true;
            const sources = document.getElementById('sources');
            sources?.appendChild(video);

            const texture = new THREE.VideoTexture(video);
            this.cameraMaterial.uniforms.uBg.value = texture;
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
                // exportVid(new Blob(chunks, { type: "video/webm;codecs=h264" }));
                downloadVideo(new Blob(chunks, { type: "video/webm;codecs=h264" }));
            rec.start();
            setTimeout(() => {
                rec.stop();
            }, 5000); // stop recording in 6s
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
                uMask: { value: null },
                uBg: { value: null },
                uResolution: { value: new THREE.Vector2(600, 670) },
                useBlur: { value: 1 },
                useBinaryMask: { value: 0 }
            },
            fragmentShader: `
                vec4 blur5(sampler2D image, vec2 uv, vec2 resolution, vec2 direction) {
                    vec4 color = vec4(0.0);
                    vec2 off1 = vec2(1.3333333333333333) * direction;
                    color += texture2D(image, uv) * 0.29411764705882354;
                    color += texture2D(image, uv + (off1 / resolution)) * 0.35294117647058826;
                    color += texture2D(image, uv - (off1 / resolution)) * 0.35294117647058826;
                    return color; 
                }
                vec4 blur9(sampler2D image, vec2 uv, vec2 resolution, vec2 direction) {
                    vec4 color = vec4(0.0);
                    vec2 off1 = vec2(1.3846153846) * direction;
                    vec2 off2 = vec2(3.2307692308) * direction;
                    color += texture2D(image, uv) * 0.2270270270;
                    color += texture2D(image, uv + (off1 / resolution)) * 0.3162162162;
                    color += texture2D(image, uv - (off1 / resolution)) * 0.3162162162;
                    color += texture2D(image, uv + (off2 / resolution)) * 0.0702702703;
                    color += texture2D(image, uv - (off2 / resolution)) * 0.0702702703;
                    return color;
                }
                vec4 blur13(sampler2D image, vec2 uv, vec2 resolution, vec2 direction) {
                    vec4 color = vec4(0.0);
                    vec2 off1 = vec2(1.411764705882353) * direction;
                    vec2 off2 = vec2(3.2941176470588234) * direction;
                    vec2 off3 = vec2(5.176470588235294) * direction;
                    color += texture2D(image, uv) * 0.1964825501511404;
                    color += texture2D(image, uv + (off1 / resolution)) * 0.2969069646728344;
                    color += texture2D(image, uv - (off1 / resolution)) * 0.2969069646728344;
                    color += texture2D(image, uv + (off2 / resolution)) * 0.09447039785044732;
                    color += texture2D(image, uv - (off2 / resolution)) * 0.09447039785044732;
                    color += texture2D(image, uv + (off3 / resolution)) * 0.010381362401148057;
                    color += texture2D(image, uv - (off3 / resolution)) * 0.010381362401148057;
                    return color;
                  }

                uniform sampler2D uMap;
                uniform sampler2D uMask;
                uniform sampler2D uBg;
                uniform vec2 uResolution;
                uniform int useBlur;
                uniform int useBinaryMask;
                varying vec2 vUv;
                void main() {
                    vec3 col = vec3(0.);
                    vec3 bg = texture2D(uBg, vUv).xyz;

                    vec3 stream = texture2D(uMap, vUv).xyz;

                    vec2 maskUv = vUv;
                    if (useBinaryMask == 0) {
                        maskUv.y = 1. - vUv.y;
                    }
                    float mask = texture2D(uMask, maskUv).r;


                    vec4 blurOutput =  blur13(uMask, maskUv, uResolution, vec2(0., 1.));
                    col = blurOutput.xyz;
                    col = mix(bg, stream, blurOutput.r);
                    
                    if (useBlur < 0) {
                        col = mix(bg, stream, mask);
                    }
                    
                    // gl_FragColor.a = mask;
                    // gl_FragColor.rgb *= mask;

                    gl_FragColor = vec4(col, 1.);
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


        this.pane.addButton({ title: 'toggle blur' }).on('click', () => {
            this.cameraMaterial.uniforms.useBlur.value *= -1;
        })
    }

    setMaskTexture(bitmap: ImageBitmap) {
        const texture = new THREE.CanvasTexture(bitmap);
        this.cameraMaterial.uniforms.uMask.value = texture;
    }

    async setupBodySegmentation() {
        const model = bodySegmentation.SupportedModels.MediaPipeSelfieSegmentation;
        const segmenterConfig = {
            // runtime: 'tfjs', // or 'tfjs'
            runtime: 'mediapipe', // or 'tfjs'
            // solutionPath: '/Users/sergio/Desktop/repositories/webARPortal/node_modules/@mediapipe/selfie_segmentation',
            solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation',
            // modelType: 'landscape'
            modelType: 'general'
        }
        this.segmenter = await bodySegmentation.createSegmenter(model, segmenterConfig);

        this.foregroundThreshold = 0.6;
        const debug = this.pane.addFolder({ title: 'bgRemovalModel' });
        debug.addInput(this, 'foregroundThreshold', {
            min: 0,
            max: 1
        })

        this.useBinaryMask = false;
        debug.addInput(this, 'useBinaryMask').on('change', () => {
            this.cameraMaterial.uniforms.useBinaryMask.value = this.useBinaryMask;
        })
    }

    async drawMask() {

        const image = this.streamElement;
        const people = await this.segmenter.segmentPeople(image);

        if (!this.useBinaryMask) {
            const btmap = await people[0].mask.toCanvasImageSource();
            this.setMaskTexture(btmap);

            const ctx = this.canvasElement.getContext('2d');
            const width = this.streamElement.offsetWidth;
            const height = this.streamElement.offsetHeight;
            this.canvasElement.setAttribute('width', String(width))
            this.canvasElement.setAttribute('height', String(height))
            ctx?.clearRect(0, 0, width, height)
            ctx?.drawImage(btmap, 0, 0, width, height)
        }

        else {
            const foregroundColor = { r: 255, g: 0, b: 0, a: 255 };
            const backgroundColor = { r: 0, g: 0, b: 0, a: 0 };
            const drawContour = false;

            const backgroundDarkeningMask = await bodySegmentation.toBinaryMask(people, foregroundColor, backgroundColor, drawContour, this.foregroundThreshold);

            const texture = new THREE.Texture(backgroundDarkeningMask);
            texture.needsUpdate = true;
            this.cameraMaterial.uniforms.uMask.value = texture

            const ctx = this.canvasElement.getContext('2d');
            const width = this.streamElement.offsetWidth;
            const height = this.streamElement.offsetHeight;
            this.canvasElement.setAttribute('width', String(width))
            this.canvasElement.setAttribute('height', String(height))

            ctx.putImageData(backgroundDarkeningMask, 0, 0)
        }
        // const opacity = 0.7;
        // const maskBlurAmount = 3; // Number of pixels to blur by.
        // const people2 = await bodySegmentation.drawMask(this.canvasElement, this.streamElement, backgroundDarkeningMask, opacity, maskBlurAmount);
    }

    onResize() {
        this.width = this.container.offsetWidth;
        this.height = this.container.offsetHeight;
        this.renderer.setSize(this.width, this.height);
        if (this.cameraMaterial) {
            this.cameraMaterial.uniforms.uResolution.value.x = this.width
            this.cameraMaterial.uniforms.uResolution.value.y = this.height
        }
    }

    async startStream() {
        console.log('HELLO')
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        this.streamElement.srcObject = stream;

        await new Promise(resolve => {
            this.streamElement.onloadedmetadata = resolve;
        });
        // this.canvasElement.style.width = this.streamElement.offsetWidth + 'px'

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