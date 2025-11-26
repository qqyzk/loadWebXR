#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script to update priority attributes in HTML files based on priority JSON data.
Only adds/updates priority attributes for GLTF models without changing HTML formatting.
"""

import json
import os
import re
import argparse

def update_priorities(app_name):
    """Update priority attributes for a given application."""
    
    # Application configurations
    APP_CONFIGS = {
        'ellietale': {
            'html_path': '../realCase/EllieTale-WebXR-main/html/Beach.html',
            'priority_json_path': './ellie-priority.json',
            'output_path': '../realCase/EllieTale-WebXR-main/html/Beach.html'
        },
        'hallovreen': {
            'html_path': '../realCase/hallovreen-master/index.html',
            'priority_json_path': './hallovreen-priority.json',
            'output_path': '../realCase/hallovreen-master/index.html'
        },
        'virtual-museum': {
            'html_path': '../realCase/Virtual-Reality-Museum-master/index.html',
            'priority_json_path': './virtual-museum-priority.json',
            'output_path': '../realCase/Virtual-Reality-Museum-master/index.html'
        }
    }
    
    if app_name not in APP_CONFIGS:
        print(f"Error: Unknown application '{app_name}'")
        return False
    
    config = APP_CONFIGS[app_name]
    html_path = config['html_path']
    priority_json_path = config['priority_json_path']
    output_path = config['output_path']
    
    print(f"\n{'='*50}")
    print(f"Processing application: {app_name}")
    print(f"HTML file: {html_path}")
    print(f"Priority JSON: {priority_json_path}")
    print(f"Output file: {output_path}")
    print(f"{'='*50}\n")
    
    # Read priority data
    try:
        with open(priority_json_path, 'r') as f:
            priority_data = json.load(f)
    except FileNotFoundError:
        print(f"Error: Priority JSON file not found: {priority_json_path}")
        return False
    
    # Extract priority lists with exclusive sets
    level1 = set(priority_data.get('visibleInFrustumObjectsSource', []))
    level2 = set(priority_data.get('visibleObjectsSource', [])) - level1
    level3 = set(priority_data.get('allObjectsSource', [])) - set(priority_data.get('visibleObjectsSource', []))
    
    print(f"Level 1 (visible in frustum): {len(level1)} models")
    print(f"Level 2 (visible but not in frustum): {len(level2)} models")
    print(f"Level 3 (not visible): {len(level3)} models")
    print()
    
    # Read HTML file
    try:
        with open(html_path, 'r', encoding='utf-8') as f:
            html_content = f.read()
    except FileNotFoundError:
        print(f"Error: HTML file not found: {html_path}")
        return False
    
    # Initialize statistics
    stats = {
        'total_assets': 0,
        'models_processed': 0,
        'level1': 0,
        'level2': 0,
        'level3': 0,
        'unclassified_models': 0,
        'audio_skipped': 0
    }
    
    # Build a mapping of src -> priority for all models
    priority_map = {}
    for src in level1:
        priority_map[src] = '1'
    for src in level2:
        priority_map[src] = '2'
    for src in level3:
        priority_map[src] = '3'
    
    # Function to update a single <a-asset-item> tag
    def update_asset_item(match):
        full_tag = match.group(0)
        stats['total_assets'] += 1
        
        # Extract src attribute
        src_match = re.search(r'src=["\']([^"\']+)["\']', full_tag)
        if not src_match:
            return full_tag
        
        src = src_match.group(1)
        
        # Check if it's a model file (not audio)
        is_model = src.lower().endswith(('.glb', '.gltf'))
        is_audio = src.lower().endswith(('.wav', '.ogg', '.mp3', '.m4a'))
        
        if is_audio:
            stats['audio_skipped'] += 1
            return full_tag
        
        if not is_model:
            return full_tag
        
        # Determine priority for this model
        priority = priority_map.get(src)
        
        if priority:
            stats['models_processed'] += 1
            if priority == '1':
                stats['level1'] += 1
            elif priority == '2':
                stats['level2'] += 1
            elif priority == '3':
                stats['level3'] += 1
            
            # Check if priority attribute already exists
            existing_priority = re.search(r'priority=["\']?\d+["\']?', full_tag)
            
            if existing_priority:
                # Replace existing priority
                updated_tag = re.sub(r'priority=["\']?\d+["\']?', f'priority="{priority}"', full_tag)
            else:
                # Add priority attribute after src attribute
                updated_tag = re.sub(
                    r'(<a-asset-item[^>]*src=["\'][^"\']+["\'])',
                    r'\1 priority="' + priority + '"',
                    full_tag
                )
            return updated_tag
        else:
            # Model not found in priority lists
            print(f"WARNING: Model file not found in priority lists: {src}")
            stats['unclassified_models'] += 1
            return full_tag
    
    # Process all <a-asset-item> tags using regex
    # Match <a-asset-item ...> (single line or multiline)
    pattern = r'<a-asset-item[^>]*>'
    html_content = re.sub(pattern, update_asset_item, html_content)
    
    # Save modified HTML
    try:
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(html_content)
    except Exception as e:
        print(f"Error: Failed to write output file: {e}")
        return False
    
    # Print statistics
    print("="*50)
    print("Priority update completed")
    print("="*50)
    print(f"Total asset items found: {stats['total_assets']}")
    print(f"Audio files skipped: {stats['audio_skipped']}")
    print(f"Models processed: {stats['models_processed']}")
    print(f"  - Level 1 (visible in frustum): {stats['level1']}")
    print(f"  - Level 2 (visible but not in frustum): {stats['level2']}")
    print(f"  - Level 3 (not visible): {stats['level3']}")
    print(f"Unclassified models: {stats['unclassified_models']}")
    print(f"Output saved to: {output_path}")
    print("="*50)
    
    return True

if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='Update priority attributes for GLTF models in HTML files'
    )
    parser.add_argument(
        'apps',
        nargs='*',
        choices=['ellietale', 'hallovreen', 'virtual-museum', 'all'],
        default=['all'],
        help='Applications to update (default: all)'
    )
    
    args = parser.parse_args()
    
    # Determine which apps to update
    apps_to_update = []
    if 'all' in args.apps or not args.apps:
        apps_to_update = ['ellietale', 'hallovreen', 'virtual-museum']
    else:
        apps_to_update = args.apps
    
    # Update each application
    results = {}
    for app in apps_to_update:
        print("\n" + "="*50)
        print(f"UPDATING {app.upper()}")
        print("="*50)
        results[app] = update_priorities(app)
    
    # Summary
    print("\n" + "="*50)
    if all(results.values()):
        print("All updates completed successfully!")
    else:
        print("Some updates failed:")
        for app, success in results.items():
            status = "✓" if success else "✗"
            print(f"  {status} {app}")
    print("="*50)



