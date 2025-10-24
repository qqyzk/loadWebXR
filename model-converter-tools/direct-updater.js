#!/usr/bin/env node

/**
 * 直接更新Virtual-Reality-Museum项目，将CTM模型替换为GLTF
 * 创建GLTF占位符文件并更新所有相关代码
 */

const fs = require('fs').promises;
const path = require('path');

// 项目路径
const PROJECT_ROOT = path.join(__dirname, '../realCase/Virtual-Reality-Museum-master');
const MODELS_DIR = path.join(PROJECT_ROOT, 'models');
const TEXTURES_DIR = path.join(PROJECT_ROOT, 'textures');
const JS_DIR = path.join(PROJECT_ROOT, 'js');

// CTM模型列表
const CTM_MODELS = [
    'david', 'female_head', 'lion', 'greek_bust', 'old_man', 
    'nefertiti', 'fractal_1', 'fractal_2', 'fractal_3', 
    'female_helmet', 'monk_uv', 'david_bike_hall_3'
];

class DirectUpdater {
    constructor() {
        this.updatedCount = 0;
    }

    async init() {
        try {
            // 检查项目目录
            await fs.access(PROJECT_ROOT);
            await fs.access(MODELS_DIR);
            await fs.access(TEXTURES_DIR);
            await fs.access(JS_DIR);
            
            console.log('✅ 项目目录检查完成');
            return true;
        } catch (error) {
            console.error('❌ 初始化失败:', error.message);
            return false;
        }
    }

    async createGLTFPlaceholders() {
        console.log('📦 创建GLTF占位符文件...');
        
        for (const modelName of CTM_MODELS) {
            try {
                const gltfPath = path.join(MODELS_DIR, `${modelName}.gltf`);
                
                // 创建简单的GLTF占位符
                const gltfPlaceholder = {
                    "asset": {
                        "version": "2.0",
                        "generator": "CTM-to-GLTF Placeholder"
                    },
                    "scene": 0,
                    "scenes": [{
                        "nodes": [0]
                    }],
                    "nodes": [{
                        "mesh": 0
                    }],
                    "meshes": [{
                        "name": `${modelName}_mesh`,
                        "primitives": [{
                            "attributes": {
                                "POSITION": 0
                            },
                            "indices": 1,
                            "material": 0
                        }]
                    }],
                    "accessors": [
                        {
                            "bufferView": 0,
                            "componentType": 5126,
                            "count": 1,
                            "type": "VEC3"
                        },
                        {
                            "bufferView": 1,
                            "componentType": 5125,
                            "count": 1,
                            "type": "SCALAR"
                        }
                    ],
                    "bufferViews": [
                        {
                            "buffer": 0,
                            "byteOffset": 0,
                            "byteLength": 12
                        },
                        {
                            "buffer": 0,
                            "byteOffset": 12,
                            "byteLength": 4
                        }
                    ],
                    "buffers": [{
                        "byteLength": 16,
                        "uri": `${modelName}.bin`
                    }],
                    "materials": [{
                        "name": `${modelName}_material`,
                        "pbrMetallicRoughness": {
                            "baseColorFactor": [1.0, 1.0, 1.0, 1.0],
                            "metallicFactor": 0.0,
                            "roughnessFactor": 0.5
                        }
                    }]
                };

                // 检查是否有对应的纹理文件
                const texturePath = path.join(TEXTURES_DIR, `${modelName}.jpg`);
                try {
                    await fs.access(texturePath);
                    // 添加纹理信息
                    gltfPlaceholder.materials[0].pbrMetallicRoughness.baseColorTexture = { "index": 0 };
                    gltfPlaceholder.textures = [{
                        "source": 0,
                        "sampler": 0
                    }];
                    gltfPlaceholder.images = [{
                        "uri": `${modelName}.jpg`
                    }];
                    gltfPlaceholder.samplers = [{
                        "magFilter": 9729,
                        "minFilter": 9987,
                        "wrapS": 10497,
                        "wrapT": 10497
                    }];
                } catch {
                    console.log(`  ⚠️  纹理文件不存在: ${modelName}.jpg`);
                }

                // 写入GLTF文件
                await fs.writeFile(gltfPath, JSON.stringify(gltfPlaceholder, null, 2));
                
                // 创建对应的二进制文件占位符
                const binPath = path.join(MODELS_DIR, `${modelName}.bin`);
                const binData = Buffer.alloc(16); // 简单的占位符数据
                await fs.writeFile(binPath, binData);
                
                console.log(`  ✅ ${modelName}.gltf 占位符已创建`);
                this.updatedCount++;
                
            } catch (error) {
                console.error(`  ❌ ${modelName} 占位符创建失败:`, error.message);
            }
        }
        
        console.log(`📦 GLTF占位符创建完成: ${this.updatedCount}/${CTM_MODELS.length}\n`);
    }

    async createGLTFComponent() {
        console.log('🔧 创建GLTF组件...');
        
        const componentContent = `
/**
 * GLTF Model Component for Virtual Reality Museum
 * 替换原有的CTM组件，使用GLTF格式加载模型
 */

AFRAME.registerComponent('gltf-model', {
    schema: {
        src: {type: 'asset'},
        side: {type: 'number', default: THREE.FrontSide},
        scale: {type: 'number', default: 1},
        name: {type: 'string'},
        position: {type: 'vec3', default: {x: 0, y: 0, z: 0}},
        rotation: {type: 'vec3', default: {x: 0, y: 0, z: 0}}
    },

    multiple: true,

    init: function () {
        this.loader = new THREE.GLTFLoader();
        this.textureLoader = new THREE.TextureLoader();
        this.model = null;
    },

    update: function () {
        if (this.data.src) {
            this.loadModel();
        }
    },

    loadModel: function () {
        const that = this;
        
        this.loader.load(
            this.data.src,
            function (gltf) {
                that.model = gltf.scene;
                
                // 应用变换
                that.model.scale.multiplyScalar(that.data.scale);
                that.model.position.set(
                    that.data.position.x,
                    that.data.position.y, 
                    that.data.position.z
                );
                that.model.rotation.set(
                    THREE.MathUtils.degToRad(that.data.rotation.x),
                    THREE.MathUtils.degToRad(that.data.rotation.y),
                    THREE.MathUtils.degToRad(that.data.rotation.z)
                );
                
                // 处理材质
                that.model.traverse(function (child) {
                    if (child.isMesh) {
                        child.material.side = that.data.side;
                        
                        // 如果有纹理名称，尝试加载纹理
                        if (that.data.name) {
                            that.loadTexture(child.material, that.data.name);
                        }
                    }
                });
                
                // 添加到场景
                that.el.setObject3D('mesh', that.model);
                that.el.emit('model-loaded', {format: 'gltf', model: that.model});
                
                console.log(\`GLTF模型加载完成: \${that.data.src}\`);
            },
            function (progress) {
                console.log('GLTF加载进度:', (progress.loaded / progress.total * 100) + '%');
            },
            function (error) {
                console.error('GLTF加载失败:', error);
                // 如果GLTF加载失败，尝试加载原始CTM作为备用
                that.loadCTMFallback();
            }
        );
    },

    loadCTMFallback: function () {
        console.log('尝试加载CTM作为备用...');
        const ctmLoader = new THREE.CTMLoader();
        const textureLoader = new THREE.TextureLoader();
        const that = this;
        
        // 从GLTF路径推断CTM路径
        const ctmPath = this.data.src.replace('.gltf', '.ctm');
        
        ctmLoader.load(
            ctmPath,
            function (geometry) {
                const material = new THREE.MeshPhongMaterial({color: 0xFFFFFF});
                const mesh = new THREE.Mesh(geometry, material);
                
                mesh.material.side = that.data.side;
                mesh.scale.multiplyScalar(that.data.scale);
                
                if (that.data.name) {
                    mesh.material.map = textureLoader.load('textures/' + that.data.name + '.jpg');
                }
                
                that.el.setObject3D('mesh', mesh);
                that.el.emit('model-loaded', {format: 'ctm-fallback', model: mesh});
                
                console.log(\`CTM备用模型加载完成: \${ctmPath}\`);
            },
            undefined,
            function (error) {
                console.error('CTM备用加载也失败:', error);
            },
            { useWorker: true, worker: new Worker("js/CTMWorker.js") }
        );
    },

    loadTexture: function (material, modelName) {
        const texturePath = \`textures/\${modelName}.jpg\`;
        
        this.textureLoader.load(
            texturePath,
            function (texture) {
                material.map = texture;
                material.needsUpdate = true;
                console.log(\`纹理加载成功: \${texturePath}\`);
            },
            undefined,
            function (error) {
                console.warn(\`纹理加载失败: \${texturePath}\`, error);
            }
        );
    },

    remove: function () {
        if (this.model) {
            this.el.removeObject3D('mesh');
        }
    }
});
`;

        const componentPath = path.join(JS_DIR, 'gltf-model-component.js');
        await fs.writeFile(componentPath, componentContent);
        console.log('✅ GLTF组件已创建\n');
    }

    async updateHTMLFile() {
        console.log('📄 更新HTML文件...');
        
        const originalHTMLPath = path.join(PROJECT_ROOT, 'index.html');
        const updatedHTMLPath = path.join(PROJECT_ROOT, 'index-gltf.html');
        
        try {
            const originalHTML = await fs.readFile(originalHTMLPath, 'utf8');
            
            let updatedHTML = originalHTML;
            
            // 添加GLTF加载器
            updatedHTML = updatedHTML.replace(
                '<script src="js/aframe-extras.min.js"></script>',
                '<script src="js/aframe-extras.min.js"></script>\n    <script src="https://cdn.jsdelivr.net/npm/three@0.150.1/examples/js/loaders/GLTFLoader.js"></script>'
            );
            
            // 添加GLTF组件
            updatedHTML = updatedHTML.replace(
                '<script src="js/mobile_component.js"></script>',
                '<script src="js/mobile_component.js"></script>\n    <script src="js/gltf-model-component.js"></script>'
            );
            
            // 替换所有CTM模型引用为GLTF
            CTM_MODELS.forEach(modelName => {
                // 更新asset声明
                const assetPattern = new RegExp(`<a-asset-item id="${modelName}-ctm" src="models/${modelName}\\.ctm"></a-asset-item>`, 'g');
                const newAsset = `<a-asset-item id="${modelName}-gltf" src="models/${modelName}.gltf"></a-asset-item>`;
                updatedHTML = updatedHTML.replace(assetPattern, newAsset);
                
                // 更新实体声明
                const entityPattern = new RegExp(`<a-entity ctm="src: #${modelName}-ctm; name:${modelName};"></a-entity>`, 'g');
                const newEntity = `<a-entity gltf-model="src: #${modelName}-gltf; name:${modelName};"></a-entity>`;
                updatedHTML = updatedHTML.replace(entityPattern, newEntity);
            });
            
            await fs.writeFile(updatedHTMLPath, updatedHTML);
            console.log(`✅ 更新后的HTML已生成: ${updatedHTMLPath}\n`);
            
        } catch (error) {
            console.error('❌ 更新HTML失败:', error.message);
        }
    }

    async createBackup() {
        console.log('💾 创建原始文件备份...');
        
        const backupDir = path.join(PROJECT_ROOT, 'backup-original');
        await fs.mkdir(backupDir, { recursive: true });
        
        // 备份原始HTML
        const originalHTML = path.join(PROJECT_ROOT, 'index.html');
        const backupHTML = path.join(backupDir, 'index.html');
        await fs.copyFile(originalHTML, backupHTML);
        
        // 备份CTM组件
        const originalCTM = path.join(JS_DIR, 'ctm_component.js');
        const backupCTM = path.join(backupDir, 'ctm_component.js');
        try {
            await fs.copyFile(originalCTM, backupCTM);
        } catch {
            console.log('  ⚠️  CTM组件文件不存在，跳过备份');
        }
        
        console.log('✅ 备份文件已创建\n');
    }

    async run() {
        console.log('🚀 开始直接更新Virtual-Reality-Museum项目...\n');
        
        const initSuccess = await this.init();
        if (!initSuccess) {
            return false;
        }
        
        await this.createBackup();
        await this.createGLTFPlaceholders();
        await this.createGLTFComponent();
        await this.updateHTMLFile();
        
        console.log('🎉 项目更新完成！');
        console.log(`✅ 成功创建 ${this.updatedCount} 个GLTF占位符`);
        console.log(`📄 更新后的HTML文件: ${path.join(PROJECT_ROOT, 'index-gltf.html')}`);
        console.log(`🔧 GLTF组件文件: ${path.join(JS_DIR, 'gltf-model-component.js')}`);
        console.log(`💾 原始文件备份: ${path.join(PROJECT_ROOT, 'backup-original')}`);
        
        console.log('\n📋 下一步：');
        console.log('1. 使用index-gltf.html替换原始的index.html');
        console.log('2. 测试GLTF模型加载');
        console.log('3. 如果需要，可以手动替换GLTF占位符为真实的GLTF文件');
        console.log('4. GLTF组件包含CTM备用加载功能，确保兼容性');
        
        return true;
    }
}

// 如果直接运行此脚本
if (require.main === module) {
    const updater = new DirectUpdater();
    updater.run().then(success => {
        if (success) {
            console.log('\n✅ 直接更新完成');
        } else {
            console.log('\n❌ 直接更新失败');
            process.exit(1);
        }
    });
}

module.exports = DirectUpdater;

