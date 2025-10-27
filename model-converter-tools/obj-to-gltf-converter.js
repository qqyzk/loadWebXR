#!/usr/bin/env node

/**
 * OBJ+MTL+Texture to GLTF/GLB Converter
 * 基于Three.js的模型转换器，支持OBJ、MTL材质文件和纹理
 */

const fs = require('fs');
const path = require('path');
const THREE = require('three');

// 动态导入Three.js的加载器和导出器
let OBJLoader, MTLLoader, GLTFExporter, TextureLoader;

async function initializeThreeJS() {
    try {
        // 使用动态导入来加载Three.js模块
        const { OBJLoader: OBJLoaderClass } = await import('three/examples/jsm/loaders/OBJLoader.js');
        const { MTLLoader: MTLLoaderClass } = await import('three/examples/jsm/loaders/MTLLoader.js');
        const { GLTFExporter: GLTFExporterClass } = await import('three/examples/jsm/exporters/GLTFExporter.js');
        
        OBJLoader = OBJLoaderClass;
        MTLLoader = MTLLoaderClass;
        GLTFExporter = GLTFExporterClass;
        TextureLoader = THREE.TextureLoader;
        
        console.log('✅ Three.js加载器初始化完成');
    } catch (error) {
        console.error('❌ Three.js加载器初始化失败:', error.message);
        throw error;
    }
}

/**
 * 文件检查工具
 */
function fileExists(filePath) {
    try {
        return fs.statSync(filePath).isFile();
    } catch (err) {
        return false;
    }
}

/**
 * 读取文件内容
 */
function readFileSync(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        console.error(`❌ 读取文件失败: ${filePath}`, error.message);
        return null;
    }
}

/**
 * OBJ到GLTF转换器类
 */
class ObjToGltfConverter {
    constructor(options = {}) {
        this.options = {
            outputFormat: 'gltf', // 'gltf' 或 'glb'
            binary: false,
            includeTextures: true,
            optimizeGeometry: true,
            verbose: true,
            ...options
        };
        
        this.objLoader = null;
        this.mtlLoader = null;
        this.gltfExporter = null;
    }
    
    /**
     * 初始化加载器
     */
    initialize() {
        if (!OBJLoader || !MTLLoader || !GLTFExporter) {
            throw new Error('Three.js加载器未初始化，请先调用 initializeThreeJS()');
        }
        
        this.objLoader = new OBJLoader();
        this.mtlLoader = new MTLLoader();
        this.gltfExporter = new GLTFExporter();
        
        if (this.options.verbose) {
            console.log('🔧 转换器初始化完成');
        }
    }
    
    /**
     * 加载MTL材质文件
     */
    async loadMaterials(mtlPath, texturePath = '') {
        return new Promise((resolve, reject) => {
            if (!fileExists(mtlPath)) {
                if (this.options.verbose) {
                    console.log(`⚠️ MTL文件不存在: ${mtlPath}`);
                }
                resolve(null);
                return;
            }
            
            // MTL文件的目录作为基础路径
            const mtlBasePath = path.dirname(mtlPath) + '/';
            this.mtlLoader.setPath(mtlBasePath);
            
            // 如果指定了纹理路径，设置资源路径
            if (texturePath && texturePath !== mtlBasePath) {
                this.mtlLoader.setResourcePath(texturePath);
            }
            
            // 只传递文件名，不是完整路径
            const mtlFilename = path.basename(mtlPath);
            
            this.mtlLoader.load(
                mtlFilename,
                (materials) => {
                    materials.preload();
                    if (this.options.verbose) {
                        console.log(`✅ MTL材质加载完成: ${mtlFilename}`);
                    }
                    resolve(materials);
                },
                (progress) => {
                    if (this.options.verbose && progress.total > 0) {
                        console.log(`📊 MTL加载进度: ${(progress.loaded / progress.total * 100).toFixed(1)}%`);
                    }
                },
                (error) => {
                    console.error(`❌ MTL加载失败: ${mtlFilename}`, error);
                    resolve(null); // 不阻塞流程，材质加载失败时继续
                }
            );
        });
    }
    
    /**
     * 加载OBJ模型
     */
    async loadOBJModel(objPath, materials = null) {
        return new Promise((resolve, reject) => {
            if (!fileExists(objPath)) {
                reject(new Error(`OBJ文件不存在: ${objPath}`));
                return;
            }
            
            // 设置路径和材质
            const basePath = path.dirname(objPath) + '/';
            this.objLoader.setPath(basePath);
            
            if (materials) {
                this.objLoader.setMaterials(materials);
            }
            
            // 只传递文件名，不是完整路径
            const objFilename = path.basename(objPath);
            
            this.objLoader.load(
                objFilename,
                (object) => {
                    if (this.options.verbose) {
                        console.log(`✅ OBJ模型加载完成: ${objFilename}`);
                        console.log(`📊 模型信息: ${object.children.length} 个子对象`);
                    }
                    resolve(object);
                },
                (progress) => {
                    if (this.options.verbose && progress.total > 0) {
                        console.log(`📊 OBJ加载进度: ${(progress.loaded / progress.total * 100).toFixed(1)}%`);
                    }
                },
                (error) => {
                    console.error(`❌ OBJ加载失败: ${objFilename}`, error);
                    reject(error);
                }
            );
        });
    }
    
    /**
     * 优化几何体
     */
    optimizeObject(object) {
        if (!this.options.optimizeGeometry) return;
        
        object.traverse((child) => {
            if (child.isMesh && child.geometry) {
                // 计算包围盒
                child.geometry.computeBoundingBox();
                child.geometry.computeBoundingSphere();
                
                // 如果有法线，重新计算
                if (!child.geometry.attributes.normal) {
                    child.geometry.computeVertexNormals();
                }
            }
        });
        
        if (this.options.verbose) {
            console.log('🔧 几何体优化完成');
        }
    }
    
    /**
     * 导出为GLTF格式
     */
    async exportGLTF(object, outputPath) {
        return new Promise((resolve, reject) => {
            const exportOptions = {
                binary: this.options.outputFormat === 'glb',
                includeCustomExtensions: true,
                embedImages: this.options.includeTextures
            };
            
            this.gltfExporter.parse(
                object,
                (result) => {
                    try {
                        let outputData;
                        let finalPath = outputPath;
                        
                        if (exportOptions.binary) {
                            // GLB格式 - 二进制
                            outputData = result;
                            finalPath = finalPath.replace(/\.gltf$/, '.glb');
                            fs.writeFileSync(finalPath, Buffer.from(result));
                        } else {
                            // GLTF格式 - JSON
                            outputData = JSON.stringify(result, null, 2);
                            finalPath = finalPath.replace(/\.glb$/, '.gltf');
                            fs.writeFileSync(finalPath, outputData);
                        }
                        
                        if (this.options.verbose) {
                            const stats = fs.statSync(finalPath);
                            console.log(`✅ GLTF导出完成: ${finalPath}`);
                            console.log(`📊 文件大小: ${(stats.size / 1024).toFixed(2)} KB`);
                        }
                        
                        resolve(finalPath);
                    } catch (error) {
                        console.error('❌ GLTF文件写入失败:', error);
                        reject(error);
                    }
                },
                (error) => {
                    console.error('❌ GLTF导出失败:', error);
                    reject(error);
                },
                exportOptions
            );
        });
    }
    
    /**
     * 转换单个模型
     */
    async convertModel(objPath, options = {}) {
        const config = {
            mtlPath: null,
            texturePath: '',
            outputPath: null,
            ...options
        };
        
        try {
            // 自动推断路径
            const objDir = path.dirname(objPath);
            const objName = path.basename(objPath, '.obj');
            
            if (!config.mtlPath) {
                config.mtlPath = path.join(objDir, `${objName}.mtl`);
            }
            
            if (!config.texturePath) {
                // 默认纹理路径是models目录的父目录下的textures文件夹
                const parentDir = path.dirname(objDir);
                const texturesDir = path.join(parentDir, 'textures');
                config.texturePath = fileExists(texturesDir) ? texturesDir + '/' : objDir + '/';
            }
            
            if (!config.outputPath) {
                const ext = this.options.outputFormat === 'glb' ? '.glb' : '.gltf';
                config.outputPath = path.join(objDir, `${objName}${ext}`);
            }
            
            if (this.options.verbose) {
                console.log(`\n🔄 开始转换: ${objName}`);
                console.log(`📁 OBJ文件: ${objPath}`);
                console.log(`📁 MTL文件: ${config.mtlPath}`);
                console.log(`📁 纹理路径: ${config.texturePath}`);
                console.log(`📁 输出路径: ${config.outputPath}`);
            }
            
            // 1. 加载材质（如果存在）
            const materials = await this.loadMaterials(config.mtlPath, config.texturePath);
            
            // 2. 加载OBJ模型
            const object = await this.loadOBJModel(objPath, materials);
            
            // 3. 优化几何体
            this.optimizeObject(object);
            
            // 4. 导出GLTF
            const outputPath = await this.exportGLTF(object, config.outputPath);
            
            if (this.options.verbose) {
                console.log(`🎉 转换完成: ${objName} -> ${path.basename(outputPath)}\n`);
            }
            
            return {
                success: true,
                inputPath: objPath,
                outputPath: outputPath,
                modelName: objName
            };
            
        } catch (error) {
            console.error(`❌ 转换失败: ${path.basename(objPath)}`, error.message);
            return {
                success: false,
                inputPath: objPath,
                error: error.message,
                modelName: path.basename(objPath, '.obj')
            };
        }
    }
}

/**
 * 命令行接口
 */
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log(`
🔧 OBJ到GLTF转换器

用法:
  node obj-to-gltf-converter.js <objPath> [options]

参数:
  objPath                   OBJ文件路径

选项:
  --format <gltf|glb>      输出格式 (默认: gltf)
  --mtl <mtlPath>          MTL文件路径 (自动推断)
  --texture <texturePath>  纹理目录路径 (自动推断)
  --output <outputPath>    输出文件路径 (自动推断)
  --no-optimize            禁用几何体优化
  --quiet                  安静模式

示例:
  node obj-to-gltf-converter.js models/floor.obj
  node obj-to-gltf-converter.js models/floor.obj --format glb
  node obj-to-gltf-converter.js models/floor.obj --mtl models/floor.mtl --output models/floor_converted.gltf
        `);
        process.exit(1);
    }
    
    try {
        // 初始化Three.js
        await initializeThreeJS();
        
        // 解析命令行参数
        const objPath = args[0];
        const options = {
            outputFormat: 'gltf',
            optimizeGeometry: true,
            verbose: true
        };
        
        const convertOptions = {};
        
        for (let i = 1; i < args.length; i++) {
            switch (args[i]) {
                case '--format':
                    options.outputFormat = args[++i];
                    break;
                case '--mtl':
                    convertOptions.mtlPath = args[++i];
                    break;
                case '--texture':
                    convertOptions.texturePath = args[++i];
                    break;
                case '--output':
                    convertOptions.outputPath = args[++i];
                    break;
                case '--no-optimize':
                    options.optimizeGeometry = false;
                    break;
                case '--quiet':
                    options.verbose = false;
                    break;
            }
        }
        
        // 创建转换器
        const converter = new ObjToGltfConverter(options);
        converter.initialize();
        
        // 执行转换
        const result = await converter.convertModel(objPath, convertOptions);
        
        if (result.success) {
            console.log('🎉 转换成功完成!');
            process.exit(0);
        } else {
            console.error('❌ 转换失败!');
            process.exit(1);
        }
        
    } catch (error) {
        console.error('❌ 程序执行失败:', error.message);
        process.exit(1);
    }
}

// 导出模块
module.exports = {
    ObjToGltfConverter,
    initializeThreeJS
};

// 如果直接运行此文件
if (require.main === module) {
    main();
}