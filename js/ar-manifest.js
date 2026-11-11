// js/ar-manifest.js
// SIGMACAR Augmented Reality (AR) Sidecar Manifest & Asset Registry
// Governs verified 1:1 real-world physical models, material bindings and platform handoffs

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SIGMA_AR_MANIFEST = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const manifest = {
    version: '1.0.0',
    updatedAt: '2026-11-10T23:14:00+07:00',
    assetRevision: 'ar-20261110-v1',
    vehicles: {
      'tesla-cybertruck': {
        id: 'tesla-cybertruck',
        name: 'Tesla Cybertruck',
        readiness: 'verified',
        dimensionsMeters: {
          length: 5.682,
          width: 2.200,
          height: 1.791
        },
        dimensionReference: 'Tesla Cybertruck Official Owners Manual 2024-2026 - Dimensions & Cargo Capacity',
        defaultGlbUrl: 'assets/models/ar/tesla_cybertruck_ar_v1.glb',
        usdzUrl: null,
        scale: 1.0,
        placement: 'floor',
        groundOffset: 0.0,
        initialYaw: 35,
        materialBindings: {
          body: {
            meshName: 'Object_4',
            materialName: 'Material_Body',
            defaultHex: '#94A3B8'
          },
          glass: {
            meshName: 'Object_5',
            materialName: 'Material_Glass'
          },
          trim: {
            meshName: 'Object_6',
            materialName: 'Material_Trim'
          },
          rims: {
            meshNames: ['Object_11', 'Object_14', 'Object_17', 'Object_20'],
            materialName: 'Material_Rims'
          },
          tires: {
            meshNames: ['Object_12', 'Object_15', 'Object_18', 'Object_21'],
            materialName: 'Material_Tires'
          }
        },
        configurations: {
          'color-0': {
            key: 'stainless-steel',
            name: 'Thép Không Gỉ 30X Nguyên Bản (Stainless Steel)',
            hex: '#94A3B8',
            glbUrl: 'assets/models/ar/tesla_cybertruck_ar_v1.glb'
          },
          'color-1': {
            key: 'stealth-black',
            name: 'Đen Satin Chiến Thuật (Satin Stealth Black)',
            hex: '#1E293B',
            glbUrl: 'assets/models/ar/tesla_cybertruck_ar_stealth_black.glb'
          },
          'color-2': {
            key: 'ceramic-white',
            name: 'Trắng Satin Bắc Cực (Satin Ceramic White)',
            hex: '#F1F5F9',
            glbUrl: 'assets/models/ar/tesla_cybertruck_ar_ceramic_white.glb'
          },
          'color-3': {
            key: 'tactical-green',
            name: 'Xanh Rêu Quân Đội (Tactical Green Wrap)',
            hex: '#3F6212',
            glbUrl: 'assets/models/ar/tesla_cybertruck_ar_tactical_green.glb'
          }
        }
      }
    },
    defaultFallback: {
      readiness: 'unverified',
      isGenericModel: true,
      glbUrl: 'assets/models/sigma-car-3d.glb',
      dimensionsMeters: {
        length: 4.800,
        width: 1.900,
        height: 1.500
      },
      scale: 1.0,
      placement: 'floor',
      note: 'Mẫu xe đang trong lộ trình số hóa AR 1:1. Tạm thời sử dụng mô hình 3D tham chiếu.'
    },

    // Helper: Retrieve AR Configuration for any vehicle and color
    getVehicleArConfig: function (carId, colorIdx = 0) {
      const v = this.vehicles[carId];
      if (v && v.readiness === 'verified') {
        const configKey = `color-${colorIdx}`;
        const colorConfig = v.configurations[configKey] || v.configurations['color-0'];
        return {
          carId: v.id,
          carName: v.name,
          readiness: 'verified',
          dimensionsMeters: v.dimensionsMeters,
          glbUrl: colorConfig.glbUrl || v.defaultGlbUrl,
          usdzUrl: v.usdzUrl,
          hex: colorConfig.hex,
          colorName: colorConfig.name,
          scale: v.scale,
          placement: v.placement,
          initialYaw: v.initialYaw,
          materialBindings: v.materialBindings
        };
      }

      // Unverified or fallback vehicle
      return {
        carId: carId,
        carName: carId,
        readiness: 'unverified',
        dimensionsMeters: this.defaultFallback.dimensionsMeters,
        glbUrl: this.defaultFallback.glbUrl,
        usdzUrl: null,
        hex: '#0284C7',
        colorName: 'Tiêu chuẩn',
        scale: this.defaultFallback.scale,
        placement: this.defaultFallback.placement,
        initialYaw: 35,
        note: this.defaultFallback.note
      };
    },

    isVehicleArVerified: function (carId) {
      return !!(this.vehicles[carId] && this.vehicles[carId].readiness === 'verified');
    }
  };

  return manifest;
}));
