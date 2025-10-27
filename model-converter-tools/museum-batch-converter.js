#!/usr/bin/env node

/**
 * Virtual Reality Museum 批量模型转换器
 * 系统性地将所有OBJ模型转换为GLB格式，并更新HTML引用
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// 设置DOM环境
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.HTMLCanvasElement = dom.window.HTMLCanvasElement;
global.FileReader = dom.window.FileReader;
global.Blob = dom.window.Blob;
global.ImageBitmap = dom.window.ImageBitmap || class ImageBitmap {};
global.createImageBitmap = dom.window.createImageBitmap || (() => Promise.resolve({}));

const THREE = require('three');

// Virtual Reality Museum 模型配置
// 基于 index.html 中的实际使用分析
const MUSEUM_MODELS = {
    floor: {
        obj: 'models/floor.obj',
        textures: {
            diffuse: 'textures/floor.jpg',
            normal: 'textures/floor_normal.jpg'
        },
        material: {
            metalness: 0.6,
            roughness: 0.4,
            side: THREE.FrontSide
        }
    },
    hall: {
        obj: 'models/hall.obj',
        textures: {
            diffuse: 'textures/hall.jpg'
            // normal: 'textures/hall_normal.jpg' // 注释掉了
        },
        material: {
            metalness: 0.0,
            roughness: 0.8,
            side: THREE.FrontSide
        }
    },
    hall_low_floor: {
        obj: 'models/hall_low_floor.obj',
        textures: {}, // 没有纹理
        material: {
            opacity: 0.0,
            transparent: true,
            side: THREE.FrontSide
        }
    },
    acropolis: {
        obj: 'models/acropolis.obj',
        textures: {
            diffuse: 'textures/acropolis.jpg'
        },
        material: {
            metalness: 0.0,
            roughness: 0.7,
            side: THREE.FrontSide
        }
    },
    castle_lake: {
        obj: 'models/castle_lake.obj',
        textures: {
            diffuse: 'textures/castle_lake.jpg'
        },
        material: {
            metalness: 0.0,
            roughness: 0.7,
            side: THREE.FrontSide
        }
    },
    good_samaritan: {
        obj: 'models/good_samaritan.obj',
        textures: {
            diffuse: 'textures/good_samaritan.jpg'
        },
        material: {
            metalness: 0.1,
            roughness: 0.6,
            side: THREE.FrontSide
        }
    },
    moonlight: {
        obj: 'models/moonlight.obj',
        textures: {
            diffuse: 'textures/moonlight.jpg'
        },
        material: {
            metalness: 0.0,
            roughness: 0.8,
            side: THREE.FrontSide
        }
    },
    podiums: {
        obj: 'models/podiums.obj',
        textures: {
            diffuse: 'textures/podiums.jpg'
        },
        material: {
            metalness: 0.3,
            roughness: 0.5,
            side: THREE.FrontSide
        }
    },
    lamps: {
        obj: 'models/lamps.obj',
        textures: {
            diffuse: 'textures/lamps.jpg'
        },
        material: {
            metalness: 0.2,
            roughness: 0.4,
            side: THREE.DoubleSide // 双面材质
        }
    }
};

/**
 * 初始化Three.js模块
 */
async function initializeThreeJS() {
    try {
        const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
        const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
        return { OBJLoader, GLTFExporter };
    } catch (error) {
        console.error('❌ Three.js模块加载失败:', error);
        throw error;
    }
}

/**
 * 加载纹理（改进版本）
 */
async function loadTexture(texturePath) {
    if (!fs.existsSync(texturePath)) {
        console.log(`⚠️ 纹理文件不存在: ${path.basename(texturePath)}`);
        return null;
    }
    
    try {
        const Canvas = require('canvas');
        const { createCanvas, loadImage } = Canvas;
        
        console.log(`📖 加载纹理: ${path.basename(texturePath)}`);
        
        const image = await loadImage(texturePath);
        const canvas = createCanvas(image.width, image.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.flipY = false;
        
        console.log(`✅ 纹理加载成功: ${path.basename(texturePath)} (${image.width}x${image.height})`);
        return texture;
        
    } catch (error) {
        console.error(`❌ 纹理加载失败: ${path.basename(texturePath)}`, error.message);
        return null;
    }
}

/**
 * 转换单个模型
 */
async function convertModel(modelName, basePath, loaders) {
    const config = MUSEUM_MODELS[modelName];
    const { OBJLoader, GLTFExporter } = loaders;
    
    console.log(`\n🔄 转换模型: ${modelName}`);
    console.log('─'.repeat(50));
    
    try {
        // 1. 加载OBJ模型
        const objPath = path.join(basePath, config.obj);
        console.log(`📦 加载OBJ: ${config.obj}`);
        
        const objLoader = new OBJLoader();
        const objContent = fs.readFileSync(objPath, 'utf8');
        const object = objLoader.parse(objContent);
        
        console.log(`✅ OBJ加载完成 (${object.children.length}个子对象)`);
        
        // 2. 加载纹理
        const textures = {};
        
        if (config.textures.diffuse) {
            const diffusePath = path.join(basePath, config.textures.diffuse);
            textures.diffuse = await loadTexture(diffusePath);
        }
        
        if (config.textures.normal) {
            const normalPath = path.join(basePath, config.textures.normal);
            textures.normal = await loadTexture(normalPath);
        }
        
        // 3. 创建材质
        const materialOptions = {
            color: 0xffffff,
            ...config.material
        };
        
        // 应用纹理
        if (textures.diffuse) {
            materialOptions.map = textures.diffuse;
        }
        if (textures.normal) {
            materialOptions.normalMap = textures.normal;
        }
        
        const material = new THREE.MeshStandardMaterial(materialOptions);
        
        console.log(`🎨 材质配置: metalness=${material.metalness}, roughness=${material.roughness}, transparent=${material.transparent}`);
        
        // 4. 应用材质到所有网格
        object.traverse((child) => {
            if (child.isMesh) {
                child.material = material;
                
                if (child.geometry) {
                    if (!child.geometry.attributes.normal) {
                        child.geometry.computeVertexNormals();
                    }
                    child.geometry.computeBoundingBox();
                    child.geometry.computeBoundingSphere();
                }
            }
        });
        
        // 5. 导出GLB
        const scene = new THREE.Scene();
        scene.add(object);
        
        const exporter = new GLTFExporter();
        const glbData = await new Promise((resolve, reject) => {
            exporter.parse(
                scene,
                (result) => resolve(result),
                (error) => reject(error),
                {
                    binary: true,
                    includeCustomExtensions: true,
                    embedImages: true,
                    maxTextureSize: 2048
                }
            );
        });
        
        // 6. 保存GLB文件
        const outputPath = path.join(basePath, 'models', `${modelName}.glb`);
        fs.writeFileSync(outputPath, Buffer.from(glbData));
        
        const stats = fs.statSync(outputPath);
        console.log(`✅ GLB导出成功: ${outputPath}`);
        console.log(`📊 文件大小: ${(stats.size / 1024).toFixed(2)} KB`);
        
        return {
            success: true,
            modelName,
            outputPath,
            fileSize: stats.size
        };
        
    } catch (error) {
        console.error(`❌ 转换失败: ${modelName}`, error.message);
        return {
            success: false,
            modelName,
            error: error.message
        };
    }
}

/**
 * 批量转换所有模型
 */
async function batchConvertModels() {
    console.log('🚀 Virtual Reality Museum 批量模型转换器');
    console.log('═'.repeat(60));
    
    try {
        // 初始化
        const loaders = await initializeThreeJS();
        const basePath = path.join(__dirname, '../realCase/Virtual-Reality-Museum-master');
        
        console.log(`📁 博物馆路径: ${basePath}`);
        console.log(`🎯 需要转换的模型数量: ${Object.keys(MUSEUM_MODELS).length}`);
        
        // 批量转换
        const results = [];
        for (const modelName of Object.keys(MUSEUM_MODELS)) {
            const result = await convertModel(modelName, basePath, loaders);
            results.push(result);
        }
        
        // 统计结果
        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);
        
        console.log('\n📊 转换结果统计:');
        console.log('═'.repeat(60));
        console.log(`✅ 成功转换: ${successful.length}/${results.length} 个模型`);
        
        if (successful.length > 0) {
            const totalSize = successful.reduce((sum, r) => sum + r.fileSize, 0);
            console.log(`📦 总文件大小: ${(totalSize / (1024*1024)).toFixed(2)} MB`);
            
            console.log('\n✅ 成功转换的模型:');
            successful.forEach(r => {
                console.log(`  - ${r.modelName}: ${(r.fileSize/1024).toFixed(2)} KB`);
            });
        }
        
        if (failed.length > 0) {
            console.log('\n❌ 转换失败的模型:');
            failed.forEach(r => {
                console.log(`  - ${r.modelName}: ${r.error}`);
            });
        }
        
        // 保存转换报告
        const report = {
            timestamp: new Date().toISOString(),
            total: results.length,
            successful: successful.length,
            failed: failed.length,
            results: results
        };
        
        const reportPath = path.join(__dirname, 'conversion-report.json');
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log(`\n📄 转换报告已保存: ${reportPath}`);
        
        return results;
        
    } catch (error) {
        console.error('❌ 批量转换失败:', error);
        return [];
    }
}

/**
 * 主函数
 */
async function main() {
    const results = await batchConvertModels();
    const successCount = results.filter(r => r.success).length;
    
    if (successCount > 0) {
        console.log(`\n🎉 批量转换完成! 成功转换 ${successCount} 个模型`);
        console.log('📝 下一步:');
        console.log('  1. 检查生成的GLB文件');
        console.log('  2. 运行 update-museum-html.js 更新HTML引用');
        console.log('  3. 在浏览器中测试效果');
    }
    
    process.exit(successCount > 0 ? 0 : 1);
}

// 导出模块
module.exports = {
    batchConvertModels,
    convertModel,
    MUSEUM_MODELS
};

// 如果直接运行
if (require.main === module) {
    main();
}
