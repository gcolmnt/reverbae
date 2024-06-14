// Imports
import * as THREE from 'three';
import Mouse from './Mouse';
import Common from './Common';
import face_vert from './glsl/sim/face.vert';
import advection_frag from './glsl/sim/advection.frag';
import line_vert from './glsl/sim/line.vert';
import mouse_vert from './glsl/sim/mouse.vert';
import externalForce_frag from './glsl/sim/externalForce.frag';
import viscous_frag from './glsl/sim/viscous.frag';
import divergence_frag from './glsl/sim/divergence.frag';
import poisson_frag from './glsl/sim/poisson.frag';
import pressure_frag from './glsl/sim/pressure.frag';

// Constants and utilities
const textureLoader = new THREE.TextureLoader();
const maskTexture = textureLoader.load('/reverbae.png');

if (!window.isDev) window.isDev = false;

export const lerp = function (start, target, easing) {
    return start + (target - start) * easing;
};

// EventBus class
class EventBus {
    constructor() {
        this.bus = document.createElement('fakeelement');
    }

    on(event, callback) {
        this.bus.addEventListener(event, callback);
    }

    off(event, callback) {
        this.bus.removeEventListener(event, callback);
    }

    emit(event, detail = {}) {
        this.bus.dispatchEvent(new CustomEvent(event, { detail }));
    }
}

export const eventBus = new EventBus();

// ShaderPass class
class ShaderPass {
    constructor(props) {
        this.props = props;
        this.uniforms = this.props.material?.uniforms;
    }

    init() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.Camera();

        if (this.uniforms) {
            this.material = new THREE.RawShaderMaterial(this.props.material);
            this.geometry = new THREE.PlaneGeometry(2.0, 2.0);
            this.plane = new THREE.Mesh(this.geometry, this.material);
            this.scene.add(this.plane);
        }
    }

    update() {
        Common.renderer.setRenderTarget(this.props.output);
        Common.renderer.render(this.scene, this.camera);
        Common.renderer.setRenderTarget(null);
    }
}

// Advection class
class Advection extends ShaderPass {
    constructor(simProps) {
        super({
            material: {
                vertexShader: face_vert,
                fragmentShader: advection_frag,
                uniforms: {
                    boundarySpace: { value: simProps.cellScale },
                    px: { value: simProps.cellScale },
                    fboSize: { value: simProps.fboSize },
                    velocity: { value: simProps.src.texture },
                    dt: { value: simProps.dt },
                },
            },
            output: simProps.dst
        });

        this.init();
    }

    init() {
        super.init();
        this.createBoundary();
    }

    createBoundary() {
        const boundaryG = new THREE.BufferGeometry();
        const vertices_boundary = new Float32Array([
            // left
            -1, -1, 0,
            -1, 1, 0,

            // top
            -1, 1, 0,
            1, 1, 0,

            // right
            1, 1, 0,
            1, -1, 0,

            // bottom
            1, -1, 0,
            -1, -1, 0
        ]);
        boundaryG.setAttribute('position', new THREE.BufferAttribute(vertices_boundary, 3));

        const boundaryM = new THREE.RawShaderMaterial({
            vertexShader: line_vert,
            fragmentShader: advection_frag,
            uniforms: this.uniforms
        });

        this.line = new THREE.LineSegments(boundaryG, boundaryM);
        this.scene.add(this.line);
    }

    update({ dt, isBounce }) {
        this.uniforms.dt.value = dt;
        this.line.visible = isBounce;

        super.update();
    }
}

// ExternalForce class


class ExternalForce extends ShaderPass {
    constructor(simProps) {
        super({
            output: simProps.dst
        });

        this.init(simProps);
    }

    init(simProps) {
        super.init();
        const mouseG = new THREE.PlaneGeometry(1, 1);

        const mouseM = new THREE.RawShaderMaterial({
            vertexShader: mouse_vert,
            fragmentShader: externalForce_frag,
            blending: THREE.AdditiveBlending,
            uniforms: {
                px: { value: simProps.cellScale },
                force: { value: new THREE.Vector2(0.0, 0.0) },
                center: { value: new THREE.Vector2(0.0, 0.0) },
                scale: { value: new THREE.Vector2(simProps.cursor_size, simProps.cursor_size) }
            },
        });

        this.mouse = new THREE.Mesh(mouseG, mouseM);
        this.scene.add(this.mouse);
    }

    update(props) {
        const forceX = Mouse.diff.x / 2 * props.mouse_force;
        const forceY = Mouse.diff.y / 2 * props.mouse_force;

        const cursorSizeX = props.cursor_size * props.cellScale.x;
        const cursorSizeY = props.cursor_size * props.cellScale.y;

        const centerX = Math.min(Math.max(Mouse.coords.x, -1 + cursorSizeX + props.cellScale.x * 2), 1 - cursorSizeX - props.cellScale.x * 2);
        const centerY = Math.min(Math.max(Mouse.coords.y, -1 + cursorSizeY + props.cellScale.y * 2), 1 - cursorSizeY - props.cellScale.y * 2);

        const uniforms = this.mouse.material.uniforms;

        uniforms.force.value.set(forceX, forceY);
        uniforms.center.value.set(centerX, centerY);
        uniforms.scale.value.set(props.cursor_size, props.cursor_size);

        super.update();
    }
}

// Viscous class


class Viscous extends ShaderPass {
    constructor(simProps) {
        super({
            material: {
                vertexShader: face_vert,
                fragmentShader: viscous_frag,
                uniforms: {
                    boundarySpace: { value: simProps.boundarySpace },
                    velocity: { value: simProps.src.texture },
                    velocity_new: { value: simProps.dst_.texture },
                    v: { value: simProps.viscous },
                    px: { value: simProps.cellScale },
                    dt: { value: simProps.dt }
                }
            },
            output: simProps.dst,
            output0: simProps.dst_,
            output1: simProps.dst
        });

        this.init();
    }

    update({ viscous, iterations, dt }) {
        let fbo_in, fbo_out;
        this.uniforms.v.value = viscous;
        for (let i = 0; i < iterations; i++) {
            if (i % 2 == 0) {
                fbo_in = this.props.output0;
                fbo_out = this.props.output1;
            } else {
                fbo_in = this.props.output1;
                fbo_out = this.props.output0;
            }

            this.uniforms.velocity_new.value = fbo_in.texture;
            this.props.output = fbo_out;
            this.uniforms.dt.value = dt;

            super.update();
        }

        return fbo_out;
    }
}

// Divergence class


class Divergence extends ShaderPass {
    constructor(simProps) {
        super({
            material: {
                vertexShader: face_vert,
                fragmentShader: divergence_frag,
                uniforms: {
                    boundarySpace: { value: simProps.boundarySpace },
                    velocity: { value: simProps.src.texture },
                    px: { value: simProps.cellScale },
                    dt: { value: simProps.dt }
                }
            },
            output: simProps.dst
        });

        this.init();
    }

    update({ vel }) {
        this.uniforms.velocity.value = vel.texture;
        super.update();
    }
}

// Poisson class


class Poisson extends ShaderPass {
    constructor(simProps) {
        super({
            material: {
                vertexShader: face_vert,
                fragmentShader: poisson_frag,
                uniforms: {
                    boundarySpace: { value: simProps.boundarySpace },
                    pressure: { value: simProps.dst_.texture },
                    divergence: { value: simProps.src.texture },
                    px: { value: simProps.cellScale }
                }
            },
            output: simProps.dst,
            output0: simProps.dst_,
            output1: simProps.dst
        });

        this.init();
    }

    update({ iterations }) {
        let p_in, p_out;

        for (let i = 0; i < iterations; i++) {
            if (i % 2 == 0) {
                p_in = this.props.output0;
                p_out = this.props.output1;
            } else {
                p_in = this.props.output1;
                p_out = this.props.output0;
            }

            this.uniforms.pressure.value = p_in.texture;
            this.props.output = p_out;
            super.update();
        }

        return p_out;
    }
}

// Pressure class


class Pressure extends ShaderPass {
    constructor(simProps) {
        super({
            material: {
                vertexShader: face_vert,
                fragmentShader: pressure_frag,
                uniforms: {
                    boundarySpace: { value: simProps.boundarySpace },
                    pressure: { value: simProps.src_p.texture },
                    velocity: { value: simProps.src_v.texture },
                    px: { value: simProps.cellScale },
                    dt: { value: simProps.dt }
                }
            },
            output: simProps.dst
        });

        this.init();
    }

    update({ vel, pressure }) {
        this.uniforms.velocity.value = vel.texture;
        this.uniforms.pressure.value = pressure.texture;
        super.update();
    }
}

// Simulation class
export default class Simulation {
    constructor(props) {
        this.props = props;

        this.fbos = {
            vel_0: null,
            vel_1: null,
            vel_viscous0: null,
            vel_viscous1: null,
            div: null,
            pressure_0: null,
            pressure_1: null
        };

        this.options = {
            iterations_poisson: 32,
            iterations_viscous: 32,
            mouse_force: 40,
            resolution: 0.5,
            cursor_size: 50 / (800 / Math.min(800, window.innerWidth)),
            viscous: 30,
            isBounce: false,
            dt: 0.014,
            isViscous: false,
            BFECC: true
        };

        this.fboSize = new THREE.Vector2();
        this.cellScale = new THREE.Vector2();
        this.boundarySpace = new THREE.Vector2();

        this.init();

        window.addEventListener('resize', this.onResize.bind(this));
    }

    init() {
        this.calcSize();
        this.createAllFBO();
        this.createShaderPass();
    }

    createAllFBO() {
        const type = (/(iPad|iPhone|iPod)/g.test(navigator.userAgent)) ? THREE.HalfFloatType : THREE.FloatType;

        for (let key in this.fbos) {
            this.fbos[key] = new THREE.WebGLRenderTarget(
                this.fboSize.x,
                this.fboSize.y,
                {
                    type: type
                }
            );
        }
    }

    onResize() {
        // Update the cursor_size on resize
        this.options.cursor_size = 50 / (800 / Math.min(800, window.innerWidth));
    }

    createShaderPass() {
        this.advection = new Advection({
            cellScale: this.cellScale,
            fboSize: this.fboSize,
            dt: this.options.dt,
            src: this.fbos.vel_0,
            dst: this.fbos.vel_1
        });

        this.externalForce = new ExternalForce({
            cellScale: this.cellScale,
            cursor_size: this.options.cursor_size,
            dst: this.fbos.vel_1,
        });

        this.viscous = new Viscous({
            cellScale: this.cellScale,
            boundarySpace: this.boundarySpace,
            viscous: this.options.viscous,
            src: this.fbos.vel_1,
            dst: this.fbos.vel_viscous1,
            dst_: this.fbos.vel_viscous0,
            dt: this.options.dt,
        });

        this.divergence = new Divergence({
            cellScale: this.cellScale,
            boundarySpace: this.boundarySpace,
            src: this.fbos.vel_viscous0,
            dst: this.fbos.div,
            dt: this.options.dt,
        });

        this.poisson = new Poisson({
            cellScale: this.cellScale,
            boundarySpace: this.boundarySpace,
            src: this.fbos.div,
            dst: this.fbos.pressure_1,
            dst_: this.fbos.pressure_0,
        });

        this.pressure = new Pressure({
            cellScale: this.cellScale,
            boundarySpace: this.boundarySpace,
            src_p: this.fbos.pressure_0,
            src_v: this.fbos.vel_viscous0,
            dst: this.fbos.vel_0,
            dt: this.options.dt,
        });
    }

    calcSize() {
        const width = Math.round(this.options.resolution * Common.width);
        const height = Math.round(this.options.resolution * Common.height);

        const px_x = 1.0 / width;
        const px_y = 1.0 / height;

        this.cellScale.set(px_x, px_y);
        this.fboSize.set(width, height);
    }

    resize() {
        this.calcSize();

        for (let key in this.fbos) {
            this.fbos[key].setSize(this.fboSize.x, this.fboSize.y);
        }
    }

    update() {
        if (this.options.isBounce) {
            this.boundarySpace.set(0, 0);
        } else {
            this.boundarySpace.copy(this.cellScale);
        }

        this.advection.update(this.options);

        this.externalForce.update({
            cursor_size: this.options.cursor_size,
            mouse_force: this.options.mouse_force,
            cellScale: this.cellScale
        });

        let vel = this.fbos.vel_1;

        if (this.options.isViscous) {
            vel = this.viscous.update({
                viscous: this.options.viscous,
                iterations: this.options.iterations_viscous,
                dt: this.options.dt
            });
        }

        this.divergence.update({ vel });

        const pressure = this.poisson.update({
            iterations: this.options.iterations_poisson,
        });

        this.pressure.update({ vel, pressure });
    }
}
