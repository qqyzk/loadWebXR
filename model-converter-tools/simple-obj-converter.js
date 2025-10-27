#!/usr/bin/env node

/**
 * 简化的OBJ到GLTF转换器
 * 先测试基本的OBJ加载和GLTF导出功能
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

// 使用require来导入Three.js
const THREE = require('three');

// 动态导入Three.js的加载器和导出器
async function createSimpleConverter() {
    // 创建基本场景
    const scene = new THREE.Scene();
    
    // 读取OBJ文件内容
    const objPath = path.join(__dirname, '../realCase/Virtual-Reality-Museum-master/models/floor.obj');
    const objContent = fs.readFileSync(objPath, 'utf8');
    
    console.log('📁 OBJ文件路径:', objPath);
    console.log('📊 文件内容长度:', objContent.length);
    
    // 手动解析简单的OBJ文件
    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    const uvs = [];
    const normals = [];
    const indices = [];
    
    const lines = objContent.split('\n');
    const positions = [];
    const textureCoords = [];
    const normalVecs = [];
    
    for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        
        if (parts[0] === 'v') {
            // 顶点坐标
            positions.push([
                parseFloat(parts[1]),
                parseFloat(parts[2]),
                parseFloat(parts[3])
            ]);
        } else if (parts[0] === 'vt') {
            // 纹理坐标
            textureCoords.push([
                parseFloat(parts[1]),
                parseFloat(parts[2])
            ]);
        } else if (parts[0] === 'vn') {
            // 法线
            normalVecs.push([
                parseFloat(parts[1]),
                parseFloat(parts[2]),
                parseFloat(parts[3])
            ]);
        } else if (parts[0] === 'f') {
            // 面 - 处理 v/vt/vn 格式
            for (let i = 1; i <= 3; i++) {
                const faceData = parts[i].split('/');
                const vIndex = parseInt(faceData[0]) - 1; // OBJ索引从1开始
                const vtIndex = parseInt(faceData[1]) - 1;
                const vnIndex = parseInt(faceData[2]) - 1;
                
                // 添加顶点
                if (positions[vIndex]) {
                    vertices.push(...positions[vIndex]);
                }
                
                // 添加纹理坐标
                if (textureCoords[vtIndex]) {
                    uvs.push(...textureCoords[vtIndex]);
                }
                
                // 添加法线
                if (normalVecs[vnIndex]) {
                    normals.push(...normalVecs[vnIndex]);
                }
            }
        }
    }
    
    console.log('📊 解析结果:');
    console.log('  - 顶点数量:', vertices.length / 3);
    console.log('  - UV坐标数量:', uvs.length / 2);
    console.log('  - 法线数量:', normals.length / 3);
    
    // 设置几何体属性
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    if (uvs.length > 0) {
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    }
    if (normals.length > 0) {
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    } else {
        geometry.computeVertexNormals();
    }
    
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    
    // 创建材质
    const material = new THREE.MeshBasicMaterial({ 
        color: 0x808080,
        side: THREE.DoubleSide 
    });
    
    // 创建网格
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    
    return scene;
}

async function convertToGLTF() {
    try {
        console.log('🚀 开始简单OBJ到GLTF转换...\n');
        
        // 动态导入GLTFExporter
        const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
        const exporter = new GLTFExporter();
        
        // 创建场景
        const scene = await createSimpleConverter();
        
        console.log('🔧 开始GLTF导出...');
        
        // 导出GLTF
        const gltfData = await new Promise((resolve, reject) => {
            exporter.parse(
                scene,
                (result) => resolve(result),
                (error) => reject(error),
                { 
                    binary: false,
                    includeCustomExtensions: true 
                }
            );
        });
        
        // 保存GLTF文件
        const outputPath = path.join(__dirname, '../realCase/Virtual-Reality-Museum-master/models/floor_simple.gltf');
        fs.writeFileSync(outputPath, JSON.stringify(gltfData, null, 2));
        
        const stats = fs.statSync(outputPath);
        console.log('✅ GLTF导出成功!');
        console.log(`📁 输出文件: ${outputPath}`);
        console.log(`📊 文件大小: ${(stats.size / 1024).toFixed(2)} KB`);
        
        // 导出GLB格式
        const glbData = await new Promise((resolve, reject) => {
            exporter.parse(
                scene,
                (result) => resolve(result),
                (error) => reject(error),
                { 
                    binary: true,
                    includeCustomExtensions: true 
                }
            );
        });
        
        const glbOutputPath = path.join(__dirname, '../realCase/Virtual-Reality-Museum-master/models/floor_simple.glb');
        fs.writeFileSync(glbOutputPath, Buffer.from(glbData));
        
        const glbStats = fs.statSync(glbOutputPath);
        console.log('✅ GLB导出成功!');
        console.log(`📁 输出文件: ${glbOutputPath}`);
        console.log(`📊 文件大小: ${(glbStats.size / 1024).toFixed(2)} KB`);
        
        console.log('\n🎉 转换完成! 现在可以在test-gltf.html中测试了。');
        
        return true;
        
    } catch (error) {
        console.error('❌ 转换失败:', error.message);
        console.error(error.stack);
        return false;
    }
}

// 如果直接运行此文件
if (require.main === module) {
    convertToGLTF().then(success => {
        process.exit(success ? 0 : 1);
    });
}

module.exports = { convertToGLTF };
