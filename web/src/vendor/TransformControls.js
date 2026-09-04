// Forked from three.js 0.185.0 examples/jsm/controls/TransformControls.js (MIT license)
// to reskin the gizmo in the style of RViz/MoveIt interactive markers:
//   - rotation rings are full circles with a candy-stripe texture, instead of
//     solid-color camera-facing half-arcs
//   - translate arrows are bolder and reach out past the rotation rings
//   - the free-move handle is a translucent sphere instead of an octahedron
// All interaction/drag math is untouched. Plane-translate squares and the
// free/screen-space rotate rings are left in place but disabled by default
// via the existing showXY/showYZ/showXZ/showE/showXYZE flags in viewer.js,
// so no other code here needed to change.
import {
	BoxGeometry,
	BufferGeometry,
	CanvasTexture,
	Color,
	Controls,
	CylinderGeometry,
	DoubleSide,
	Euler,
	Float32BufferAttribute,
	Line,
	LineBasicMaterial,
	LinearFilter,
	Matrix4,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	Object3D,
	OctahedronGeometry,
	PlaneGeometry,
	Quaternion,
	Raycaster,
	RepeatWrapping,
	SphereGeometry,
	SRGBColorSpace,
	TorusGeometry,
	Vector3
} from 'three';

const _raycaster = new Raycaster();

const _tempVector = new Vector3();
const _tempVector2 = new Vector3();
const _tempQuaternion = new Quaternion();
const _unit = {
	X: new Vector3( 1, 0, 0 ),
	Y: new Vector3( 0, 1, 0 ),
	Z: new Vector3( 0, 0, 1 )
};

/**
 * Fires if any type of change (object or property change) is performed. Property changes
 * are separate events you can add event listeners to. The event type is "propertyname-changed".
 *
 * @event TransformControls#change
 * @type {Object}
 */
const _changeEvent = { type: 'change' };

/**
 * Fires if a pointer (mouse/touch) becomes active.
 *
 * @event TransformControls#mouseDown
 * @type {Object}
 */
const _mouseDownEvent = { type: 'mouseDown', mode: null };

/**
 * Fires if a pointer (mouse/touch) is no longer active.
 *
 * @event TransformControls#mouseUp
 * @type {Object}
 */
const _mouseUpEvent = { type: 'mouseUp', mode: null };

/**
 * Fires if the controlled 3D object is changed.
 *
 * @event TransformControls#objectChange
 * @type {Object}
 */
const _objectChangeEvent = { type: 'objectChange' };

/**
 * This class can be used to transform objects in 3D space by adapting a similar interaction model
 * of DCC tools like Blender. Unlike other controls, it is not intended to transform the scene's camera.
 *
 * `TransformControls` expects that its attached 3D object is part of the scene graph.
 *
 * @augments Controls
 * @three_import import { TransformControls } from 'three/addons/controls/TransformControls.js';
 */
class TransformControls extends Controls {

	/**
	 * Constructs a new controls instance.
	 *
	 * @param {Camera} camera - The camera of the rendered scene.
	 * @param {?HTMLElement} domElement - The HTML element used for event listeners.
	 */
	constructor( camera, domElement = null ) {

		super( undefined, domElement );

		const root = new TransformControlsRoot( this );
		this._root = root;

		const gizmo = new TransformControlsGizmo();
		this._gizmo = gizmo;
		root.add( gizmo );

		const plane = new TransformControlsPlane();
		this._plane = plane;
		root.add( plane );

		const scope = this;

		// Defined getter, setter and store for a property
		function defineProperty( propName, defaultValue ) {

			let propValue = defaultValue;

			Object.defineProperty( scope, propName, {

				get: function () {

					return propValue !== undefined ? propValue : defaultValue;

				},

				set: function ( value ) {

					if ( propValue !== value ) {

						propValue = value;
						plane[ propName ] = value;
						gizmo[ propName ] = value;

						scope.dispatchEvent( { type: propName + '-changed', value: value } );
						scope.dispatchEvent( _changeEvent );

					}

				}

			} );

			scope[ propName ] = defaultValue;
			plane[ propName ] = defaultValue;
			gizmo[ propName ] = defaultValue;

		}

		// Define properties with getters/setter
		// Setting the defined property will automatically trigger change event
		// Defined properties are passed down to gizmo and plane

		/**
		 * The camera of the rendered scene.
		 *
		 * @name TransformControls#camera
		 * @type {Camera}
		 */
		defineProperty( 'camera', camera );
		defineProperty( 'object', undefined );
		defineProperty( 'enabled', true );

		/**
		 * The current transformation axis.
		 *
		 * @name TransformControls#axis
		 * @type {string}
		 */
		defineProperty( 'axis', null );

		/**
		 * The current transformation axis.
		 *
		 * @name TransformControls#mode
		 * @type {('translate'|'rotate'|'scale')}
		 * @default 'translate'
		 */
		defineProperty( 'mode', 'translate' );

		/**
		 * By default, 3D objects are continuously translated. If you set this property to a numeric
		 * value (world units), you can define in which steps the 3D object should be translated.
		 *
		 * @name TransformControls#translationSnap
		 * @type {?number}
		 * @default null
		 */
		defineProperty( 'translationSnap', null );

		/**
		 * By default, 3D objects are continuously rotated. If you set this property to a numeric
		 * value (radians), you can define in which steps the 3D object should be rotated.
		 *
		 * @name TransformControls#rotationSnap
		 * @type {?number}
		 * @default null
		 */
		defineProperty( 'rotationSnap', null );

		/**
		 * By default, 3D objects are continuously scaled. If you set this property to a numeric
		 * value, you can define in which steps the 3D object should be scaled.
		 *
		 * @name TransformControls#scaleSnap
		 * @type {?number}
		 * @default null
		 */
		defineProperty( 'scaleSnap', null );

		/**
		 * Defines in which coordinate space transformations should be performed.
		 *
		 * @name TransformControls#space
		 * @type {('world'|'local')}
		 * @default 'world'
		 */
		defineProperty( 'space', 'world' );

		/**
		 * The size of the helper UI (axes/planes).
		 *
		 * @name TransformControls#size
		 * @type {number}
		 * @default 1
		 */
		defineProperty( 'size', 1 );

		/**
		 * The viewport rectangle, in logical (CSS) pixels with the origin at the lower-left
		 * of the canvas. Set this when the renderer uses a sub-canvas viewport so pointer
		 * coordinates map to the correct region. If `null`, the full canvas is used.
		 *
		 * @name TransformControls#viewport
		 * @type {?Vector4}
		 * @default null
		 */
		this.viewport = null;

		/**
		 * Whether dragging is currently performed or not.
		 *
		 * @name TransformControls#dragging
		 * @type {boolean}
		 * @readonly
		 * @default false
		 */
		defineProperty( 'dragging', false );

		/**
		 * Whether the x-axis helper should be visible or not.
		 *
		 * @name TransformControls#showX
		 * @type {boolean}
		 * @default true
		 */
		defineProperty( 'showX', true );

		/**
		 * Whether the y-axis helper should be visible or not.
		 *
		 * @name TransformControls#showY
		 * @type {boolean}
		 * @default true
		 */
		defineProperty( 'showY', true );

		/**
		 * Whether the z-axis helper should be visible or not.
		 *
		 * @name TransformControls#showZ
		 * @type {boolean}
		 * @default true
		 */
		defineProperty( 'showZ', true );

		/**
		 * Whether the xy-plane helper should be visible or not.
		 *
		 * @name TransformControls#showXY
		 * @type {boolean}
		 * @default true
		 */
		defineProperty( 'showXY', true );

		/**
		 * Whether the yz-plane helper should be visible or not.
		 *
		 * @name TransformControls#showYZ
		 * @type {boolean}
		 * @default true
		 */
		defineProperty( 'showYZ', true );

		/**
		 * Whether the xz-axis helper should be visible or not.
		 *
		 * @name TransformControls#showXZ
		 * @type {boolean}
		 * @default true
		 */
		defineProperty( 'showXZ', true );

		/**
		 * Whether the xyze rotation helper should be visible or not.
		 *
		 * @name TransformControls#showXYZE
		 * @type {boolean}
		 * @default true
		 */
		defineProperty( 'showXYZE', true );

		/**
		 * Whether the e rotation helper should be visible or not.
		 *
		 * @name TransformControls#showE
		 * @type {boolean}
		 * @default true
		 */
		defineProperty( 'showE', true );

		/**
		 * The minimum allowed X position during translation.
		 *
		 * @name TransformControls#minX
		 * @type {number}
		 * @default -Infinity
		 */
		defineProperty( 'minX', - Infinity );

		/**
		 * The maximum allowed X position during translation.
		 *
		 * @name TransformControls#maxX
		 * @type {number}
		 * @default Infinity
		 */
		defineProperty( 'maxX', Infinity );

		/**
		 * The minimum allowed y position during translation.
		 *
		 * @name TransformControls#minY
		 * @type {number}
		 * @default -Infinity
		 */
		defineProperty( 'minY', - Infinity );

		/**
		 * The maximum allowed Y position during translation.
		 *
		 * @name TransformControls#maxY
		 * @type {number}
		 * @default Infinity
		 */
		defineProperty( 'maxY', Infinity );

		/**
		 * The minimum allowed z position during translation.
		 *
		 * @name TransformControls#minZ
		 * @type {number}
		 * @default -Infinity
		 */
		defineProperty( 'minZ', - Infinity );

		/**
		 * The maximum allowed Z position during translation.
		 *
		 * @name TransformControls#maxZ
		 * @type {number}
		 * @default Infinity
		 */
		defineProperty( 'maxZ', Infinity );

		// Reusable utility variables

		const worldPosition = new Vector3();
		const worldPositionStart = new Vector3();
		const worldQuaternion = new Quaternion();
		const worldQuaternionStart = new Quaternion();
		const cameraPosition = new Vector3();
		const cameraQuaternion = new Quaternion();
		const pointStart = new Vector3();
		const pointEnd = new Vector3();
		const rotationAxis = new Vector3();
		const rotationAngle = 0;
		const eye = new Vector3();

		// TODO: remove properties unused in plane and gizmo

		defineProperty( 'worldPosition', worldPosition );
		defineProperty( 'worldPositionStart', worldPositionStart );
		defineProperty( 'worldQuaternion', worldQuaternion );
		defineProperty( 'worldQuaternionStart', worldQuaternionStart );
		defineProperty( 'cameraPosition', cameraPosition );
		defineProperty( 'cameraQuaternion', cameraQuaternion );
		defineProperty( 'pointStart', pointStart );
		defineProperty( 'pointEnd', pointEnd );
		defineProperty( 'rotationAxis', rotationAxis );
		defineProperty( 'rotationAngle', rotationAngle );
		defineProperty( 'eye', eye );

		this._offset = new Vector3();
		this._startNorm = new Vector3();
		this._endNorm = new Vector3();
		// Tracks the drag point from the previous pointerMove call, for incremental
		// axis-rotation (see pointerMove's rotate branch).
		this._rotatePrevPoint = new Vector3();
		this._rotateMeasureAxis = new Vector3();
		this._cameraScale = new Vector3();

		this._parentPosition = new Vector3();
		this._parentQuaternion = new Quaternion();
		this._parentQuaternionInv = new Quaternion();
		this._parentScale = new Vector3();

		this._worldScaleStart = new Vector3();
		this._worldQuaternionInv = new Quaternion();
		this._worldScale = new Vector3();

		this._positionStart = new Vector3();
		this._quaternionStart = new Quaternion();
		this._scaleStart = new Vector3();

		this._getPointer = getPointer.bind( this );
		this._onPointerDown = onPointerDown.bind( this );
		this._onPointerHover = onPointerHover.bind( this );
		this._onPointerMove = onPointerMove.bind( this );
		this._onPointerUp = onPointerUp.bind( this );

		if ( domElement !== null ) {

			this.connect( domElement );

		}

	}

	connect( element ) {

		super.connect( element );

		this.domElement.addEventListener( 'pointerdown', this._onPointerDown );
		this.domElement.addEventListener( 'pointermove', this._onPointerHover );
		this.domElement.addEventListener( 'pointerup', this._onPointerUp );

		this.domElement.style.touchAction = 'none'; // Disable touch scroll

	}

	disconnect() {

		this.domElement.removeEventListener( 'pointerdown', this._onPointerDown );
		this.domElement.removeEventListener( 'pointermove', this._onPointerHover );
		this.domElement.removeEventListener( 'pointermove', this._onPointerMove );
		this.domElement.removeEventListener( 'pointerup', this._onPointerUp );

		this.domElement.style.touchAction = ''; // Restore touch scroll

	}

	/**
	 * Returns the visual representation of the controls. Add the helper to your scene to
	 * visually transform the attached  3D object.
	 *
	 * @return {TransformControlsRoot} The helper.
	 */
	getHelper() {

		return this._root;

	}

	pointerHover( pointer ) {

		if ( this.object === undefined || this.dragging === true ) return;

		if ( pointer !== null ) _raycaster.setFromCamera( pointer, this.camera );

		// MoveIt/RViz-style: translate arrows and rotate rings are both live at once,
		// so hit-test both picker groups and let the nearer hit decide which family
		// (mode) becomes active -- everything downstream (drag math, highlighting)
		// keys off `this.mode`/`this.axis` exactly as upstream did for a single mode.
		const translateHit = intersectObjectWithRay( this._gizmo.picker[ 'translate' ], _raycaster );
		const rotateHit = intersectObjectWithRay( this._gizmo.picker[ 'rotate' ], _raycaster );

		let intersect = null;
		let hitMode = null;

		if ( translateHit && ( ! rotateHit || translateHit.distance <= rotateHit.distance ) ) {

			intersect = translateHit;
			hitMode = 'translate';

		} else if ( rotateHit ) {

			intersect = rotateHit;
			hitMode = 'rotate';

		}

		if ( intersect ) {

			this.mode = hitMode;
			this.axis = intersect.object.name;

		} else {

			this.axis = null;

		}

	}

	pointerDown( pointer ) {

		if ( this.object === undefined || this.dragging === true || ( pointer != null && pointer.button !== 0 ) ) return;

		if ( this.axis !== null ) {

			if ( pointer !== null ) _raycaster.setFromCamera( pointer, this.camera );

			const planeIntersect = intersectObjectWithRay( this._plane, _raycaster, true );

			if ( planeIntersect ) {

				this.object.updateMatrixWorld();
				this.object.parent.updateMatrixWorld();

				this._positionStart.copy( this.object.position );
				this._quaternionStart.copy( this.object.quaternion );
				this._scaleStart.copy( this.object.scale );

				this.object.matrixWorld.decompose( this.worldPositionStart, this.worldQuaternionStart, this._worldScaleStart );

				this.pointStart.copy( planeIntersect.point ).sub( this.worldPositionStart );
				this._rotatePrevPoint.copy( this.pointStart );

			}

			this.dragging = true;
			_mouseDownEvent.mode = this.mode;
			this.dispatchEvent( _mouseDownEvent );

		}

	}

	pointerMove( pointer ) {

		const axis = this.axis;
		const mode = this.mode;
		const object = this.object;
		let space = this.space;

		if ( mode === 'scale' ) {

			space = 'local';

		} else if ( axis === 'E' || axis === 'XYZE' || axis === 'XYZ' ) {

			space = 'world';

		}

		if ( object === undefined || axis === null || this.dragging === false || ( pointer !== null && pointer.button !== - 1 ) ) return;

		if ( pointer !== null ) _raycaster.setFromCamera( pointer, this.camera );

		const planeIntersect = intersectObjectWithRay( this._plane, _raycaster, true );

		if ( ! planeIntersect ) return;

		this.pointEnd.copy( planeIntersect.point ).sub( this.worldPositionStart );

		if ( mode === 'translate' ) {

			// Apply translate

			this._offset.copy( this.pointEnd ).sub( this.pointStart );

			if ( space === 'local' && axis !== 'XYZ' ) {

				this._offset.applyQuaternion( this._worldQuaternionInv );

			}

			if ( axis.indexOf( 'X' ) === - 1 ) this._offset.x = 0;
			if ( axis.indexOf( 'Y' ) === - 1 ) this._offset.y = 0;
			if ( axis.indexOf( 'Z' ) === - 1 ) this._offset.z = 0;

			if ( space === 'local' && axis !== 'XYZ' ) {

				this._offset.applyQuaternion( this._quaternionStart ).divide( this._parentScale );

			} else {

				this._offset.applyQuaternion( this._parentQuaternionInv ).divide( this._parentScale );

			}

			object.position.copy( this._offset ).add( this._positionStart );

			// Apply translation snap

			if ( this.translationSnap ) {

				if ( space === 'local' ) {

					object.position.applyQuaternion( _tempQuaternion.copy( this._quaternionStart ).invert() );

					if ( axis.search( 'X' ) !== - 1 ) {

						object.position.x = Math.round( object.position.x / this.translationSnap ) * this.translationSnap;

					}

					if ( axis.search( 'Y' ) !== - 1 ) {

						object.position.y = Math.round( object.position.y / this.translationSnap ) * this.translationSnap;

					}

					if ( axis.search( 'Z' ) !== - 1 ) {

						object.position.z = Math.round( object.position.z / this.translationSnap ) * this.translationSnap;

					}

					object.position.applyQuaternion( this._quaternionStart );

				}

				if ( space === 'world' ) {

					object.getWorldPosition( _tempVector );

					if ( axis.search( 'X' ) !== - 1 ) {

						_tempVector.x = Math.round( _tempVector.x / this.translationSnap ) * this.translationSnap;

					}

					if ( axis.search( 'Y' ) !== - 1 ) {

						_tempVector.y = Math.round( _tempVector.y / this.translationSnap ) * this.translationSnap;

					}

					if ( axis.search( 'Z' ) !== - 1 ) {

						_tempVector.z = Math.round( _tempVector.z / this.translationSnap ) * this.translationSnap;

					}

					object.position.copy( object.parent.worldToLocal( _tempVector ) );

				}

			}

			object.position.x = Math.max( this.minX, Math.min( this.maxX, object.position.x ) );
			object.position.y = Math.max( this.minY, Math.min( this.maxY, object.position.y ) );
			object.position.z = Math.max( this.minZ, Math.min( this.maxZ, object.position.z ) );

		} else if ( mode === 'scale' ) {

			if ( axis.search( 'XYZ' ) !== - 1 ) {

				let d = this.pointEnd.length() / this.pointStart.length();

				if ( this.pointEnd.dot( this.pointStart ) < 0 ) d *= - 1;

				_tempVector2.set( d, d, d );

			} else {

				_tempVector.copy( this.pointStart );
				_tempVector2.copy( this.pointEnd );

				_tempVector.applyQuaternion( this._worldQuaternionInv );
				_tempVector2.applyQuaternion( this._worldQuaternionInv );

				_tempVector2.divide( _tempVector );

				if ( axis.search( 'X' ) === - 1 ) {

					_tempVector2.x = 1;

				}

				if ( axis.search( 'Y' ) === - 1 ) {

					_tempVector2.y = 1;

				}

				if ( axis.search( 'Z' ) === - 1 ) {

					_tempVector2.z = 1;

				}

			}

			// Apply scale

			object.scale.copy( this._scaleStart ).multiply( _tempVector2 );

			if ( this.scaleSnap ) {

				if ( axis.search( 'X' ) !== - 1 ) {

					object.scale.x = Math.round( object.scale.x / this.scaleSnap ) * this.scaleSnap || this.scaleSnap;

				}

				if ( axis.search( 'Y' ) !== - 1 ) {

					object.scale.y = Math.round( object.scale.y / this.scaleSnap ) * this.scaleSnap || this.scaleSnap;

				}

				if ( axis.search( 'Z' ) !== - 1 ) {

					object.scale.z = Math.round( object.scale.z / this.scaleSnap ) * this.scaleSnap || this.scaleSnap;

				}

			}

		} else if ( mode === 'rotate' ) {

			this._offset.copy( this.pointEnd ).sub( this.pointStart );

			const ROTATION_SPEED = 20 / this.worldPosition.distanceTo( _tempVector.setFromMatrixPosition( this.camera.matrixWorld ) );

			const isAxisRotate = ( axis === 'X' || axis === 'Y' || axis === 'Z' );

			if ( axis === 'XYZE' ) {

				this.rotationAxis.copy( this._offset ).cross( this.eye ).normalize();
				this.rotationAngle = this._offset.dot( _tempVector.copy( this.rotationAxis ).cross( this.eye ) ) * ROTATION_SPEED;

			} else if ( isAxisRotate ) {

				// Bug (reported): dragging a full ring past ~90-180 deg from the grab
				// point reversed the rotation direction. Upstream re-derives the TOTAL
				// rotation since the original grab point every call, by projecting the
				// offset onto a tangent-direction approximation (`axis x eye`) that is
				// only valid *near the grab point* -- it silently goes wrong, including
				// sign flips, for larger total offsets, which a full 360 deg ring
				// invites far more than upstream's original half-arc ever did.
				//
				// Fix: measure the TRUE signed angle the drag point has swept around
				// the axis since the *previous* call (projecting both onto the plane
				// perpendicular to the axis and using angleTo + a cross-product sign),
				// and accumulate that increment onto the object's current orientation
				// instead of recomputing from scratch against a fixed reference.
				// `rotationAxis` is the FIXED local-frame axis (e.g. (0,0,1) for 'Z'):
				// that's what the final composition below needs (post-multiplying by
				// a rotation around the fixed local axis is the correct way to spin
				// an object around its own current axis, whatever that axis already
				// is -- see the "Apply rotate" section).
				//
				// But the angle must be measured against the axis's CURRENT WORLD
				// direction -- for local space that's the axis rotated by the
				// object's current orientation (the ring is drawn tilted with the
				// object, e.g. once a prior rotation, or a non-identity parent frame,
				// has tilted it), not the flat world axis. Using the untilted axis
				// here was the bug: any rotation whose parent/prior orientation
				// wasn't already identity measured the drag against the wrong plane
				// and came out wrong (reported for local Z, but the same mismatch
				// applies to X/Y once the frame isn't axis-aligned with its parent).
				this.rotationAxis.copy( _unit[ axis ] );

				if ( space === 'local' ) {

					this._rotateMeasureAxis.copy( _unit[ axis ] ).applyQuaternion( this.worldQuaternion );

				} else {

					this._rotateMeasureAxis.copy( _unit[ axis ] );

				}

				_tempVector.copy( this._rotatePrevPoint ).projectOnPlane( this._rotateMeasureAxis );
				_tempVector2.copy( this.pointEnd ).projectOnPlane( this._rotateMeasureAxis );

				if ( _tempVector.lengthSq() > 1e-8 && _tempVector2.lengthSq() > 1e-8 ) {

					_tempVector.normalize();
					_tempVector2.normalize();

					this.rotationAngle = _tempVector.angleTo( _tempVector2 );
					this.rotationAngle *= ( this._startNorm.crossVectors( _tempVector, _tempVector2 ).dot( this._rotateMeasureAxis ) < 0 ? - 1 : 1 );

				} else {

					this.rotationAngle = 0;

				}

				this._rotatePrevPoint.copy( this.pointEnd );

			} else {

				// E (free / screen-space rotate), hidden by default in this app.
				this.rotationAxis.copy( this.eye );
				this.rotationAngle = this.pointEnd.angleTo( this.pointStart );

				this._startNorm.copy( this.pointStart ).normalize();
				this._endNorm.copy( this.pointEnd ).normalize();

				this.rotationAngle *= ( this._endNorm.cross( this._startNorm ).dot( this.eye ) < 0 ? 1 : - 1 );

			}

			// Apply rotation snap

			if ( this.rotationSnap ) this.rotationAngle = Math.round( this.rotationAngle / this.rotationSnap ) * this.rotationSnap;

			// Apply rotate
			if ( isAxisRotate ) {

				// Incremental: accumulate this step's delta directly onto the object's
				// current orientation (rotationAngle above is the delta since the last
				// call, not the total since the grab point).
				_tempQuaternion.setFromAxisAngle( this.rotationAxis, this.rotationAngle );

				if ( space === 'local' ) {

					object.quaternion.multiply( _tempQuaternion ).normalize();

				} else {

					_tempQuaternion.setFromAxisAngle(
						_tempVector.copy( this.rotationAxis ).applyQuaternion( this._parentQuaternionInv ),
						this.rotationAngle
					);
					object.quaternion.premultiply( _tempQuaternion ).normalize();

				}

			} else if ( space === 'local' ) {

				object.quaternion.copy( this._quaternionStart );
				object.quaternion.multiply( _tempQuaternion.setFromAxisAngle( this.rotationAxis, this.rotationAngle ) ).normalize();

			} else {

				this.rotationAxis.applyQuaternion( this._parentQuaternionInv );
				object.quaternion.copy( _tempQuaternion.setFromAxisAngle( this.rotationAxis, this.rotationAngle ) );
				object.quaternion.multiply( this._quaternionStart ).normalize();

			}

		}

		this.dispatchEvent( _changeEvent );
		this.dispatchEvent( _objectChangeEvent );

	}

	pointerUp( pointer ) {

		if ( pointer !== null && pointer.button !== 0 ) return;

		if ( this.dragging && ( this.axis !== null ) ) {

			_mouseUpEvent.mode = this.mode;
			this.dispatchEvent( _mouseUpEvent );

		}

		this.dragging = false;
		this.axis = null;

	}

	dispose() {

		this.disconnect();

		this._root.dispose();

	}

	/**
	 * Sets the 3D object that should be transformed and ensures the controls UI is visible.
	 *
	 * @param {Object3D} object -  The 3D object that should be transformed.
	 * @return {TransformControls} A reference to this controls.
	 */
	attach( object ) {

		this.object = object;
		this._root.visible = true;

		return this;

	}

	/**
	 * Removes the current 3D object from the controls and makes the helper UI invisible.
	 *
	 * @return {TransformControls} A reference to this controls.
	 */
	detach() {

		this.object = undefined;
		this.axis = null;

		this._root.visible = false;

		return this;

	}

	/**
	 * Resets the object's position, rotation and scale to when the current transform began.
	 */
	reset() {

		if ( ! this.enabled ) return;

		if ( this.dragging ) {

			this.object.position.copy( this._positionStart );
			this.object.quaternion.copy( this._quaternionStart );
			this.object.scale.copy( this._scaleStart );

			this.dispatchEvent( _changeEvent );
			this.dispatchEvent( _objectChangeEvent );

			this.pointStart.copy( this.pointEnd );

		}

	}

	/**
	 * Returns the raycaster that is used for user interaction. This object is shared between all
	 * instances of `TransformControls`.
	 *
	 * @returns {Raycaster} The internal raycaster.
	 */
	getRaycaster() {

		return _raycaster;

	}

	/**
	 * Returns the transformation mode.
	 *
	 * @returns {'translate'|'rotate'|'scale'} The transformation mode.
	 */
	getMode() {

		return this.mode;

	}

	/**
	 * Sets the given transformation mode.
	 *
	 * @param {'translate'|'rotate'|'scale'} mode - The transformation mode to set.
	 */
	setMode( mode ) {

		this.mode = mode;

	}

	/**
	 * Sets the translation snap.
	 *
	 * @param {?number} translationSnap - The translation snap to set.
	 */
	setTranslationSnap( translationSnap ) {

		this.translationSnap = translationSnap;

	}

	/**
	 * Sets the rotation snap.
	 *
	 * @param {?number} rotationSnap - The rotation snap to set.
	 */
	setRotationSnap( rotationSnap ) {

		this.rotationSnap = rotationSnap;

	}

	/**
	 * Sets the scale snap.
	 *
	 * @param {?number} scaleSnap - The scale snap to set.
	 */
	setScaleSnap( scaleSnap ) {

		this.scaleSnap = scaleSnap;

	}

	/**
	 * Sets the size of the helper UI.
	 *
	 * @param {number} size - The size to set.
	 */
	setSize( size ) {

		this.size = size;

	}

	/**
	 * Sets the coordinate space in which transformations are applied.
	 *
	 * @param {'world'|'local'} space - The space to set.
	 */
	setSpace( space ) {

		this.space = space;

	}

	/**
	 * Sets the colors of the control's gizmo.
	 *
	 * @param {number|Color|string} xAxis - The x-axis color.
	 * @param {number|Color|string} yAxis - The y-axis color.
	 * @param {number|Color|string} zAxis - The z-axis color.
	 * @param {number|Color|string} active - The color for active elements.
	 */
	setColors( xAxis, yAxis, zAxis, active ) {

		const materialLib = this._gizmo.materialLib;

		materialLib.xAxis.color.set( xAxis );
		materialLib.yAxis.color.set( yAxis );
		materialLib.zAxis.color.set( zAxis );
		materialLib.active.color.set( active );
		materialLib.xAxisTransparent.color.set( xAxis );
		materialLib.yAxisTransparent.color.set( yAxis );
		materialLib.zAxisTransparent.color.set( zAxis );
		materialLib.activeTransparent.color.set( active );

		// update color caches

		if ( materialLib.xAxis._color ) materialLib.xAxis._color.set( xAxis );
		if ( materialLib.yAxis._color ) materialLib.yAxis._color.set( yAxis );
		if ( materialLib.zAxis._color ) materialLib.zAxis._color.set( zAxis );
		if ( materialLib.active._color ) materialLib.active._color.set( active );
		if ( materialLib.xAxisTransparent._color ) materialLib.xAxisTransparent._color.set( xAxis );
		if ( materialLib.yAxisTransparent._color ) materialLib.yAxisTransparent._color.set( yAxis );
		if ( materialLib.zAxisTransparent._color ) materialLib.zAxisTransparent._color.set( zAxis );
		if ( materialLib.activeTransparent._color ) materialLib.activeTransparent._color.set( active );

	}

}

// mouse / touch event handlers

function getPointer( event ) {

	if ( this.domElement.ownerDocument.pointerLockElement ) {

		return {
			x: 0,
			y: 0,
			button: event.button
		};

	} else {

		const rect = this.domElement.getBoundingClientRect();
		const viewport = this.viewport;

		let originX, originY, regionWidth, regionHeight;

		if ( viewport !== null ) {

			originX = viewport.x;
			originY = rect.height - viewport.y - viewport.w;
			regionWidth = viewport.z;
			regionHeight = viewport.w;

		} else {

			originX = 0;
			originY = 0;
			regionWidth = rect.width;
			regionHeight = rect.height;

		}

		return {
			x: ( event.clientX - rect.left - originX ) / regionWidth * 2 - 1,
			y: - ( event.clientY - rect.top - originY ) / regionHeight * 2 + 1,
			button: event.button
		};

	}

}

function onPointerHover( event ) {

	if ( ! this.enabled ) return;

	switch ( event.pointerType ) {

		case 'mouse':
		case 'pen':
			this.pointerHover( this._getPointer( event ) );
			break;

	}

}

function onPointerDown( event ) {

	if ( ! this.enabled ) return;

	if ( ! document.pointerLockElement ) {

		this.domElement.setPointerCapture( event.pointerId );

	}

	this.domElement.addEventListener( 'pointermove', this._onPointerMove );

	this.pointerHover( this._getPointer( event ) );
	this.pointerDown( this._getPointer( event ) );

}

function onPointerMove( event ) {

	if ( ! this.enabled ) return;

	this.pointerMove( this._getPointer( event ) );

}

function onPointerUp( event ) {

	if ( ! this.enabled ) return;

	this.domElement.releasePointerCapture( event.pointerId );

	this.domElement.removeEventListener( 'pointermove', this._onPointerMove );

	this.pointerUp( this._getPointer( event ) );

}

function intersectObjectWithRay( object, raycaster, includeInvisible ) {

	const allIntersections = raycaster.intersectObject( object, true );

	for ( let i = 0; i < allIntersections.length; i ++ ) {

		if ( allIntersections[ i ].object.visible || includeInvisible ) {

			return allIntersections[ i ];

		}

	}

	return false;

}

//

// Reusable utility variables

const _tempEuler = new Euler();
const _alignVector = new Vector3( 0, 1, 0 );
const _zeroVector = new Vector3( 0, 0, 0 );
const _lookAtMatrix = new Matrix4();
const _tempQuaternion2 = new Quaternion();
const _identityQuaternion = new Quaternion();
const _dirVector = new Vector3();
const _tempMatrix = new Matrix4();

const _unitX = new Vector3( 1, 0, 0 );
const _unitY = new Vector3( 0, 1, 0 );
const _unitZ = new Vector3( 0, 0, 1 );

const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();

class TransformControlsRoot extends Object3D {

	constructor( controls ) {

		super();

		this.isTransformControlsRoot = true;

		this.controls = controls;
		this.visible = false;

	}

	// updateMatrixWorld updates key transformation variables
	updateMatrixWorld( force ) {

		const controls = this.controls;

		if ( controls.object !== undefined ) {

			controls.object.updateMatrixWorld();

			if ( controls.object.parent === null ) {

				console.error( 'TransformControls: The attached 3D object must be a part of the scene graph.' );

			} else {

				controls.object.parent.matrixWorld.decompose( controls._parentPosition, controls._parentQuaternion, controls._parentScale );

			}

			controls.object.matrixWorld.decompose( controls.worldPosition, controls.worldQuaternion, controls._worldScale );

			controls._parentQuaternionInv.copy( controls._parentQuaternion ).invert();
			controls._worldQuaternionInv.copy( controls.worldQuaternion ).invert();

		}

		controls.camera.updateMatrixWorld();
		controls.camera.matrixWorld.decompose( controls.cameraPosition, controls.cameraQuaternion, controls._cameraScale );

		if ( controls.camera.isOrthographicCamera ) {

			controls.camera.getWorldDirection( controls.eye ).negate();

		} else {

			controls.eye.copy( controls.cameraPosition ).sub( controls.worldPosition ).normalize();

		}

		// Cancel out the parent's transform so the gizmo stays world-aligned.

		if ( this.parent ) {

			_tempMatrix.copy( this.parent.matrixWorld ).invert();
			_tempMatrix.decompose( this.position, this.quaternion, this.scale );

		}

		super.updateMatrixWorld( force );

	}

	dispose() {

		this.traverse( function ( child ) {

			if ( child.geometry ) child.geometry.dispose();
			if ( child.material ) child.material.dispose();

		} );

	}

}

class TransformControlsGizmo extends Object3D {

	constructor() {

		super();

		this.isTransformControlsGizmo = true;

		this.type = 'TransformControlsGizmo';

		// shared materials

		// A lit material (unlike upstream's unlit MeshBasicMaterial) so handles pick
		// up the scene's lights and read as solid, glossy 3D markers -- like RViz/
		// MoveIt's Ogre-rendered interactive markers -- instead of flat cartoon color.
		// A moderate emissive keeps them legible on their unlit side too.
		const gizmoMaterial = new MeshStandardMaterial( {
			depthTest: false,
			depthWrite: false,
			fog: false,
			toneMapped: false,
			transparent: true,
			roughness: 0.4,
			metalness: 0.1,
			emissiveIntensity: 0.35
		} );

		const gizmoLineMaterial = new LineBasicMaterial( {
			depthTest: false,
			depthWrite: false,
			fog: false,
			toneMapped: false,
			transparent: true
		} );

		// Make unique material for each axis/color. `.emissive` is set alongside
		// `.color` (matching gizmoMaterial's emissiveIntensity) so each handle stays
		// legible even on its unlit side, instead of going dark like a plain lit
		// material would.
		function coloredMat( hex, opacity ) {

			const m = gizmoMaterial.clone();
			m.color.setHex( hex );
			m.emissive.setHex( hex );
			if ( opacity !== undefined ) m.opacity = opacity;
			return m;

		}

		const matInvisible = gizmoMaterial.clone();
		matInvisible.opacity = 0.15;

		const matHelper = gizmoLineMaterial.clone();
		matHelper.opacity = 0.5;

		const matRed = coloredMat( 0xff0000 );
		const matGreen = coloredMat( 0x00ff00 );
		const matBlue = coloredMat( 0x0000ff );

		const matRedTransparent = coloredMat( 0xff0000, 0.5 );
		const matGreenTransparent = coloredMat( 0x00ff00, 0.5 );
		const matBlueTransparent = coloredMat( 0x0000ff, 0.5 );

		const matWhiteTransparent = gizmoMaterial.clone();
		matWhiteTransparent.opacity = 0.25;

		const matYellowTransparent = coloredMat( 0xffff00, 0.25 );
		const matYellow = coloredMat( 0xffff00 );
		const matGray = coloredMat( 0x787878 );

		// Candy-stripe ring texture (alternating bright/dark bands around the circumference),
		// the signature look of RViz/MoveIt interactive-marker rotation rings. Repeats along
		// TorusGeometry's U coordinate, which wraps around the ring's main circumference.
		function stripeTexture( hex ) {

			const size = 128;
			const canvas = document.createElement( 'canvas' );
			canvas.width = size;
			canvas.height = 16;
			const ctx = canvas.getContext( '2d' );
			const bright = new Color( hex );
			const dark = bright.clone().multiplyScalar( 0.12 );
			const bands = 12;
			const bandWidth = size / bands;
			for ( let i = 0; i < bands; i ++ ) {

				ctx.fillStyle = `#${ ( i % 2 === 0 ? bright : dark ).getHexString() }`;
				ctx.fillRect( i * bandWidth, 0, bandWidth, canvas.height );

			}

			const texture = new CanvasTexture( canvas );
			texture.wrapS = RepeatWrapping;
			texture.colorSpace = SRGBColorSpace;
			// Mipmapping would blur the bands into a near-solid average color at typical
			// gizmo screen sizes, defeating the candy-stripe look, so keep it crisp.
			texture.generateMipmaps = false;
			texture.minFilter = LinearFilter;
			texture.magFilter = LinearFilter;
			return texture;

		}

		const matRedRing = matRed.clone();
		matRedRing.map = stripeTexture( 0xff0000 );

		const matGreenRing = matGreen.clone();
		matGreenRing.map = stripeTexture( 0x00ff00 );

		const matBlueRing = matBlue.clone();
		matBlueRing.map = stripeTexture( 0x0000ff );

		const matFreeMove = coloredMat( 0xbfe9e6, 0.45 );

		// materials in the below property are configurable via setColors()

		this.materialLib = {
			xAxis: matRed,
			yAxis: matGreen,
			zAxis: matBlue,
			active: matYellow,
			xAxisTransparent: matRedTransparent,
			yAxisTransparent: matGreenTransparent,
			zAxisTransparent: matBlueTransparent,
			activeTransparent: matYellowTransparent
		};

		// reusable geometry

		// Bolder cone/shaft than upstream (0.04/0.0075), and reaching out past the
		// rotation rings (ARM_REACH > ring radius 0.5), to read as a solid MoveIt/RViz
		// arrow marker rather than a thin wireframe gizmo.
		const ARM_REACH = 0.75;
		const arrowGeometry = new CylinderGeometry( 0, 0.06, 0.14, 16 );
		arrowGeometry.translate( 0, 0.07, 0 );

		const scaleHandleGeometry = new BoxGeometry( 0.08, 0.08, 0.08 );
		scaleHandleGeometry.translate( 0, 0.04, 0 );

		const lineGeometry = new BufferGeometry();
		lineGeometry.setAttribute( 'position', new Float32BufferAttribute( [ 0, 0, 0,	1, 0, 0 ], 3 ) );

		const lineGeometry2 = new CylinderGeometry( 0.016, 0.016, ARM_REACH, 12 );
		lineGeometry2.translate( 0, ARM_REACH / 2, 0 );

		function CircleGeometry( radius, arc ) {

			// Chunky tube (upstream: 0.0075 radius / 3 segments) so full rings read as
			// solid MoveIt/RViz-style handles rather than a thin wireframe circle.
			const geometry = new TorusGeometry( radius, 0.035, 16, 64, arc * Math.PI * 2 );
			geometry.rotateY( Math.PI / 2 );
			geometry.rotateX( Math.PI / 2 );
			return geometry;

		}

		// Special geometry for transform helper. If scaled with position vector it spans from [0,0,0] to position

		function TranslateHelperGeometry() {

			const geometry = new BufferGeometry();

			geometry.setAttribute( 'position', new Float32BufferAttribute( [ 0, 0, 0, 1, 1, 1 ], 3 ) );

			return geometry;

		}

		// Gizmo definitions - custom hierarchy definitions for setupGizmo() function

		const gizmoTranslate = {
			X: [
				[ new Mesh( arrowGeometry, matRed ), [ ARM_REACH, 0, 0 ], [ 0, 0, - Math.PI / 2 ]],
				[ new Mesh( arrowGeometry, matRed ), [ - ARM_REACH, 0, 0 ], [ 0, 0, Math.PI / 2 ]],
				[ new Mesh( lineGeometry2, matRed ), [ 0, 0, 0 ], [ 0, 0, - Math.PI / 2 ]]
			],
			Y: [
				[ new Mesh( arrowGeometry, matGreen ), [ 0, ARM_REACH, 0 ]],
				[ new Mesh( arrowGeometry, matGreen ), [ 0, - ARM_REACH, 0 ], [ Math.PI, 0, 0 ]],
				[ new Mesh( lineGeometry2, matGreen ) ]
			],
			Z: [
				[ new Mesh( arrowGeometry, matBlue ), [ 0, 0, ARM_REACH ], [ Math.PI / 2, 0, 0 ]],
				[ new Mesh( arrowGeometry, matBlue ), [ 0, 0, - ARM_REACH ], [ - Math.PI / 2, 0, 0 ]],
				[ new Mesh( lineGeometry2, matBlue ), null, [ Math.PI / 2, 0, 0 ]]
			],
			XYZ: [
				[ new Mesh( new SphereGeometry( 0.28, 24, 16 ), matFreeMove ), [ 0, 0, 0 ]]
			]
			// upstream also has XY/YZ/XZ plane-translate squares here; MoveIt/RViz
			// interactive markers don't have a plane-drag affordance, so they're dropped.
		};

		const pickerTranslate = {
			X: [
				[ new Mesh( new CylinderGeometry( 0.2, 0, 0.9, 4 ), matInvisible ), [ ARM_REACH * 0.6, 0, 0 ], [ 0, 0, - Math.PI / 2 ]],
				[ new Mesh( new CylinderGeometry( 0.2, 0, 0.9, 4 ), matInvisible ), [ - ARM_REACH * 0.6, 0, 0 ], [ 0, 0, Math.PI / 2 ]]
			],
			Y: [
				[ new Mesh( new CylinderGeometry( 0.2, 0, 0.9, 4 ), matInvisible ), [ 0, ARM_REACH * 0.6, 0 ]],
				[ new Mesh( new CylinderGeometry( 0.2, 0, 0.9, 4 ), matInvisible ), [ 0, - ARM_REACH * 0.6, 0 ], [ 0, 0, Math.PI ]]
			],
			Z: [
				[ new Mesh( new CylinderGeometry( 0.2, 0, 0.9, 4 ), matInvisible ), [ 0, 0, ARM_REACH * 0.6 ], [ Math.PI / 2, 0, 0 ]],
				[ new Mesh( new CylinderGeometry( 0.2, 0, 0.9, 4 ), matInvisible ), [ 0, 0, - ARM_REACH * 0.6 ], [ - Math.PI / 2, 0, 0 ]]
			],
			XYZ: [
				[ new Mesh( new SphereGeometry( 0.32, 12, 8 ), matInvisible ), [ 0, 0, 0 ]]
			]
		};

		const helperTranslate = {
			START: [
				[ new Mesh( new OctahedronGeometry( 0.01, 2 ), matHelper ), null, null, null, 'helper' ]
			],
			END: [
				[ new Mesh( new OctahedronGeometry( 0.01, 2 ), matHelper ), null, null, null, 'helper' ]
			],
			DELTA: [
				[ new Line( TranslateHelperGeometry(), matHelper ), null, null, null, 'helper' ]
			],
			X: [
				[ new Line( lineGeometry, matHelper ), [ - 1e3, 0, 0 ], null, [ 1e6, 1, 1 ], 'helper' ]
			],
			Y: [
				[ new Line( lineGeometry, matHelper ), [ 0, - 1e3, 0 ], [ 0, 0, Math.PI / 2 ], [ 1e6, 1, 1 ], 'helper' ]
			],
			Z: [
				[ new Line( lineGeometry, matHelper ), [ 0, 0, - 1e3 ], [ 0, - Math.PI / 2, 0 ], [ 1e6, 1, 1 ], 'helper' ]
			]
		};

		const gizmoRotate = {
			XYZE: [
				[ new Mesh( CircleGeometry( 0.5, 1 ), matGray ), null, [ 0, Math.PI / 2, 0 ]]
			],
			X: [
				[ new Mesh( CircleGeometry( 0.5, 1 ), matRedRing ) ]
			],
			Y: [
				[ new Mesh( CircleGeometry( 0.5, 1 ), matGreenRing ), null, [ 0, 0, - Math.PI / 2 ]]
			],
			Z: [
				[ new Mesh( CircleGeometry( 0.5, 1 ), matBlueRing ), null, [ 0, Math.PI / 2, 0 ]]
			],
			E: [
				[ new Mesh( CircleGeometry( 0.75, 1 ), matYellowTransparent ), null, [ 0, Math.PI / 2, 0 ]]
			]
		};

		const helperRotate = {
			AXIS: [
				[ new Line( lineGeometry, matHelper ), [ - 1e3, 0, 0 ], null, [ 1e6, 1, 1 ], 'helper' ]
			]
		};

		const pickerRotate = {
			XYZE: [
				[ new Mesh( new SphereGeometry( 0.25, 10, 8 ), matInvisible ) ]
			],
			X: [
				[ new Mesh( new TorusGeometry( 0.5, 0.1, 4, 24 ), matInvisible ), [ 0, 0, 0 ], [ 0, - Math.PI / 2, - Math.PI / 2 ]],
			],
			Y: [
				[ new Mesh( new TorusGeometry( 0.5, 0.1, 4, 24 ), matInvisible ), [ 0, 0, 0 ], [ Math.PI / 2, 0, 0 ]],
			],
			Z: [
				[ new Mesh( new TorusGeometry( 0.5, 0.1, 4, 24 ), matInvisible ), [ 0, 0, 0 ], [ 0, 0, - Math.PI / 2 ]],
			],
			E: [
				[ new Mesh( new TorusGeometry( 0.75, 0.1, 2, 24 ), matInvisible ) ]
			]
		};

		const gizmoScale = {
			X: [
				[ new Mesh( scaleHandleGeometry, matRed ), [ 0.5, 0, 0 ], [ 0, 0, - Math.PI / 2 ]],
				[ new Mesh( lineGeometry2, matRed ), [ 0, 0, 0 ], [ 0, 0, - Math.PI / 2 ]],
				[ new Mesh( scaleHandleGeometry, matRed ), [ - 0.5, 0, 0 ], [ 0, 0, Math.PI / 2 ]],
			],
			Y: [
				[ new Mesh( scaleHandleGeometry, matGreen ), [ 0, 0.5, 0 ]],
				[ new Mesh( lineGeometry2, matGreen ) ],
				[ new Mesh( scaleHandleGeometry, matGreen ), [ 0, - 0.5, 0 ], [ 0, 0, Math.PI ]],
			],
			Z: [
				[ new Mesh( scaleHandleGeometry, matBlue ), [ 0, 0, 0.5 ], [ Math.PI / 2, 0, 0 ]],
				[ new Mesh( lineGeometry2, matBlue ), [ 0, 0, 0 ], [ Math.PI / 2, 0, 0 ]],
				[ new Mesh( scaleHandleGeometry, matBlue ), [ 0, 0, - 0.5 ], [ - Math.PI / 2, 0, 0 ]]
			],
			XY: [
				[ new Mesh( new BoxGeometry( 0.15, 0.15, 0.01 ), matBlueTransparent ), [ 0.15, 0.15, 0 ]]
			],
			YZ: [
				[ new Mesh( new BoxGeometry( 0.15, 0.15, 0.01 ), matRedTransparent ), [ 0, 0.15, 0.15 ], [ 0, Math.PI / 2, 0 ]]
			],
			XZ: [
				[ new Mesh( new BoxGeometry( 0.15, 0.15, 0.01 ), matGreenTransparent ), [ 0.15, 0, 0.15 ], [ - Math.PI / 2, 0, 0 ]]
			],
			XYZ: [
				[ new Mesh( new BoxGeometry( 0.1, 0.1, 0.1 ), matWhiteTransparent ) ],
			]
		};

		const pickerScale = {
			X: [
				[ new Mesh( new CylinderGeometry( 0.2, 0, 0.6, 4 ), matInvisible ), [ 0.3, 0, 0 ], [ 0, 0, - Math.PI / 2 ]],
				[ new Mesh( new CylinderGeometry( 0.2, 0, 0.6, 4 ), matInvisible ), [ - 0.3, 0, 0 ], [ 0, 0, Math.PI / 2 ]]
			],
			Y: [
				[ new Mesh( new CylinderGeometry( 0.2, 0, 0.6, 4 ), matInvisible ), [ 0, 0.3, 0 ]],
				[ new Mesh( new CylinderGeometry( 0.2, 0, 0.6, 4 ), matInvisible ), [ 0, - 0.3, 0 ], [ 0, 0, Math.PI ]]
			],
			Z: [
				[ new Mesh( new CylinderGeometry( 0.2, 0, 0.6, 4 ), matInvisible ), [ 0, 0, 0.3 ], [ Math.PI / 2, 0, 0 ]],
				[ new Mesh( new CylinderGeometry( 0.2, 0, 0.6, 4 ), matInvisible ), [ 0, 0, - 0.3 ], [ - Math.PI / 2, 0, 0 ]]
			],
			XY: [
				[ new Mesh( new BoxGeometry( 0.2, 0.2, 0.01 ), matInvisible ), [ 0.15, 0.15, 0 ]],
			],
			YZ: [
				[ new Mesh( new BoxGeometry( 0.2, 0.2, 0.01 ), matInvisible ), [ 0, 0.15, 0.15 ], [ 0, Math.PI / 2, 0 ]],
			],
			XZ: [
				[ new Mesh( new BoxGeometry( 0.2, 0.2, 0.01 ), matInvisible ), [ 0.15, 0, 0.15 ], [ - Math.PI / 2, 0, 0 ]],
			],
			XYZ: [
				[ new Mesh( new BoxGeometry( 0.2, 0.2, 0.2 ), matInvisible ), [ 0, 0, 0 ]],
			]
		};

		const helperScale = {
			X: [
				[ new Line( lineGeometry, matHelper ), [ - 1e3, 0, 0 ], null, [ 1e6, 1, 1 ], 'helper' ]
			],
			Y: [
				[ new Line( lineGeometry, matHelper ), [ 0, - 1e3, 0 ], [ 0, 0, Math.PI / 2 ], [ 1e6, 1, 1 ], 'helper' ]
			],
			Z: [
				[ new Line( lineGeometry, matHelper ), [ 0, 0, - 1e3 ], [ 0, - Math.PI / 2, 0 ], [ 1e6, 1, 1 ], 'helper' ]
			]
		};

		// Creates an Object3D with gizmos described in custom hierarchy definition.

		function setupGizmo( gizmoMap ) {

			const gizmo = new Object3D();

			for ( const name in gizmoMap ) {

				for ( let i = gizmoMap[ name ].length; i --; ) {

					const object = gizmoMap[ name ][ i ][ 0 ].clone();
					const position = gizmoMap[ name ][ i ][ 1 ];
					const rotation = gizmoMap[ name ][ i ][ 2 ];
					const scale = gizmoMap[ name ][ i ][ 3 ];
					const tag = gizmoMap[ name ][ i ][ 4 ];

					// name and tag properties are essential for picking and updating logic.
					object.name = name;
					object.tag = tag;

					if ( position ) {

						object.position.set( position[ 0 ], position[ 1 ], position[ 2 ] );

					}

					if ( rotation ) {

						object.rotation.set( rotation[ 0 ], rotation[ 1 ], rotation[ 2 ] );

					}

					if ( scale ) {

						object.scale.set( scale[ 0 ], scale[ 1 ], scale[ 2 ] );

					}

					object.updateMatrix();

					const tempGeometry = object.geometry.clone();
					tempGeometry.applyMatrix4( object.matrix );
					object.geometry = tempGeometry;
					object.renderOrder = Infinity;

					object.position.set( 0, 0, 0 );
					object.rotation.set( 0, 0, 0 );
					object.scale.set( 1, 1, 1 );

					gizmo.add( object );

				}

			}

			return gizmo;

		}

		// Gizmo creation

		this.gizmo = {};
		this.picker = {};
		this.helper = {};

		// MoveIt/RViz-style: translate and rotate handles are shown and pickable at the
		// same time (see TransformControls#pointerHover and #updateMatrixWorld), so each
		// handle is tagged with the family it belongs to instead of relying on the single
		// `mode` string to disambiguate two groups that reuse the same 'X'/'Y'/'Z' names.
		function tagFamily( container, family ) {

			container.traverse( ( child ) => { child.family = family; } );
			return container;

		}

		this.add( this.gizmo[ 'translate' ] = tagFamily( setupGizmo( gizmoTranslate ), 'translate' ) );
		this.add( this.gizmo[ 'rotate' ] = tagFamily( setupGizmo( gizmoRotate ), 'rotate' ) );
		this.add( this.gizmo[ 'scale' ] = tagFamily( setupGizmo( gizmoScale ), 'scale' ) );
		this.add( this.picker[ 'translate' ] = tagFamily( setupGizmo( pickerTranslate ), 'translate' ) );
		this.add( this.picker[ 'rotate' ] = tagFamily( setupGizmo( pickerRotate ), 'rotate' ) );
		this.add( this.picker[ 'scale' ] = tagFamily( setupGizmo( pickerScale ), 'scale' ) );
		this.add( this.helper[ 'translate' ] = setupGizmo( helperTranslate ) );
		this.add( this.helper[ 'rotate' ] = setupGizmo( helperRotate ) );
		this.add( this.helper[ 'scale' ] = setupGizmo( helperScale ) );

		// Pickers should be hidden always

		this.picker[ 'translate' ].visible = false;
		this.picker[ 'rotate' ].visible = false;
		this.picker[ 'scale' ].visible = false;

	}

	// updateMatrixWorld will update transformations and appearance of individual handles

	updateMatrixWorld( force ) {

		const space = ( this.mode === 'scale' ) ? 'local' : this.space; // scale always oriented to local rotation

		const quaternion = ( space === 'local' ) ? this.worldQuaternion : _identityQuaternion;

		// MoveIt/RViz-style: translate and rotate handles are both shown (and both
		// pickable, see pointerHover) all the time, instead of upstream's one-mode-
		// at-a-time gizmo. `mode` still exists -- it now just tracks which family the
		// pointer is over/dragging, for the highlight and per-family alignment logic
		// below. `scale` is never entered by this app, so its gizmo stays hidden.

		this.gizmo[ 'translate' ].visible = true;
		this.gizmo[ 'rotate' ].visible = true;
		this.gizmo[ 'scale' ].visible = false;

		this.helper[ 'translate' ].visible = this.mode === 'translate';
		this.helper[ 'rotate' ].visible = this.mode === 'rotate';
		this.helper[ 'scale' ].visible = this.mode === 'scale';


		let handles = [];
		handles = handles.concat( this.picker[ 'translate' ].children, this.picker[ 'rotate' ].children );
		handles = handles.concat( this.gizmo[ 'translate' ].children, this.gizmo[ 'rotate' ].children );
		handles = handles.concat( this.helper[ this.mode ].children );

		for ( let i = 0; i < handles.length; i ++ ) {

			const handle = handles[ i ];

			// hide aligned to camera

			handle.visible = true;
			handle.rotation.set( 0, 0, 0 );
			handle.position.copy( this.worldPosition );

			let factor;

			if ( this.camera.isOrthographicCamera ) {

				factor = ( this.camera.top - this.camera.bottom ) / this.camera.zoom;

			} else {

				factor = this.worldPosition.distanceTo( this.cameraPosition ) * Math.min( 1.9 * Math.tan( Math.PI * this.camera.fov / 360 ) / this.camera.zoom, 7 );

			}

			handle.scale.set( 1, 1, 1 ).multiplyScalar( factor * this.size / 4 );

			// TODO: simplify helpers and consider decoupling from gizmo

			if ( handle.tag === 'helper' ) {

				handle.visible = false;

				if ( handle.name === 'AXIS' ) {

					handle.visible = !! this.axis;

					if ( this.axis === 'X' ) {

						_tempQuaternion.setFromEuler( _tempEuler.set( 0, 0, 0 ) );
						handle.quaternion.copy( quaternion ).multiply( _tempQuaternion );

						if ( Math.abs( _alignVector.copy( _unitX ).applyQuaternion( quaternion ).dot( this.eye ) ) > 0.9 ) {

							handle.visible = false;

						}

					}

					if ( this.axis === 'Y' ) {

						_tempQuaternion.setFromEuler( _tempEuler.set( 0, 0, Math.PI / 2 ) );
						handle.quaternion.copy( quaternion ).multiply( _tempQuaternion );

						if ( Math.abs( _alignVector.copy( _unitY ).applyQuaternion( quaternion ).dot( this.eye ) ) > 0.9 ) {

							handle.visible = false;

						}

					}

					if ( this.axis === 'Z' ) {

						_tempQuaternion.setFromEuler( _tempEuler.set( 0, Math.PI / 2, 0 ) );
						handle.quaternion.copy( quaternion ).multiply( _tempQuaternion );

						if ( Math.abs( _alignVector.copy( _unitZ ).applyQuaternion( quaternion ).dot( this.eye ) ) > 0.9 ) {

							handle.visible = false;

						}

					}

					if ( this.axis === 'XYZE' ) {

						_tempQuaternion.setFromEuler( _tempEuler.set( 0, Math.PI / 2, 0 ) );
						_alignVector.copy( this.rotationAxis );
						handle.quaternion.setFromRotationMatrix( _lookAtMatrix.lookAt( _zeroVector, _alignVector, _unitY ) );
						handle.quaternion.multiply( _tempQuaternion );
						handle.visible = this.dragging;

					}

					if ( this.axis === 'E' ) {

						handle.visible = false;

					}


				} else if ( handle.name === 'START' ) {

					handle.position.copy( this.worldPositionStart );
					handle.visible = this.dragging;

				} else if ( handle.name === 'END' ) {

					handle.position.copy( this.worldPosition );
					handle.visible = this.dragging;

				} else if ( handle.name === 'DELTA' ) {

					handle.position.copy( this.worldPositionStart );
					handle.quaternion.copy( this.worldQuaternionStart );
					_tempVector.set( 1e-10, 1e-10, 1e-10 ).add( this.worldPositionStart ).sub( this.worldPosition ).multiplyScalar( - 1 );
					_tempVector.applyQuaternion( this.worldQuaternionStart.clone().invert() );
					handle.scale.copy( _tempVector );
					handle.visible = this.dragging;

				} else {

					handle.quaternion.copy( quaternion );

					if ( this.dragging ) {

						handle.position.copy( this.worldPositionStart );

					} else {

						handle.position.copy( this.worldPosition );

					}

					if ( this.axis ) {

						handle.visible = this.axis.search( handle.name ) !== - 1;

					}

				}

				// If updating helper, skip rest of the loop
				continue;

			}

			// Align handles to current local or world rotation

			handle.quaternion.copy( quaternion );

			if ( handle.family === 'translate' || handle.family === 'scale' ) {

				// Hide translate and scale axis facing the camera

				const AXIS_HIDE_THRESHOLD = 0.99;
				const PLANE_HIDE_THRESHOLD = 0.2;

				if ( handle.name === 'X' ) {

					if ( Math.abs( _alignVector.copy( _unitX ).applyQuaternion( quaternion ).dot( this.eye ) ) > AXIS_HIDE_THRESHOLD ) {

						handle.scale.set( 1e-10, 1e-10, 1e-10 );
						handle.visible = false;

					}

				}

				if ( handle.name === 'Y' ) {

					if ( Math.abs( _alignVector.copy( _unitY ).applyQuaternion( quaternion ).dot( this.eye ) ) > AXIS_HIDE_THRESHOLD ) {

						handle.scale.set( 1e-10, 1e-10, 1e-10 );
						handle.visible = false;

					}

				}

				if ( handle.name === 'Z' ) {

					if ( Math.abs( _alignVector.copy( _unitZ ).applyQuaternion( quaternion ).dot( this.eye ) ) > AXIS_HIDE_THRESHOLD ) {

						handle.scale.set( 1e-10, 1e-10, 1e-10 );
						handle.visible = false;

					}

				}

				if ( handle.name === 'XY' ) {

					if ( Math.abs( _alignVector.copy( _unitZ ).applyQuaternion( quaternion ).dot( this.eye ) ) < PLANE_HIDE_THRESHOLD ) {

						handle.scale.set( 1e-10, 1e-10, 1e-10 );
						handle.visible = false;

					}

				}

				if ( handle.name === 'YZ' ) {

					if ( Math.abs( _alignVector.copy( _unitX ).applyQuaternion( quaternion ).dot( this.eye ) ) < PLANE_HIDE_THRESHOLD ) {

						handle.scale.set( 1e-10, 1e-10, 1e-10 );
						handle.visible = false;

					}

				}

				if ( handle.name === 'XZ' ) {

					if ( Math.abs( _alignVector.copy( _unitY ).applyQuaternion( quaternion ).dot( this.eye ) ) < PLANE_HIDE_THRESHOLD ) {

						handle.scale.set( 1e-10, 1e-10, 1e-10 );
						handle.visible = false;

					}

				}

			} else if ( handle.family === 'rotate' ) {

				// Align handles to current local or world rotation

				_tempQuaternion2.copy( quaternion );
				_alignVector.copy( this.eye ).applyQuaternion( _tempQuaternion.copy( quaternion ).invert() );

				if ( handle.name.search( 'E' ) !== - 1 ) {

					handle.quaternion.setFromRotationMatrix( _lookAtMatrix.lookAt( this.eye, _zeroVector, _unitY ) );

				}

				if ( handle.name === 'X' ) {

					_tempQuaternion.setFromAxisAngle( _unitX, Math.atan2( - _alignVector.y, _alignVector.z ) );
					_tempQuaternion.multiplyQuaternions( _tempQuaternion2, _tempQuaternion );
					handle.quaternion.copy( _tempQuaternion );

				}

				if ( handle.name === 'Y' ) {

					_tempQuaternion.setFromAxisAngle( _unitY, Math.atan2( _alignVector.x, _alignVector.z ) );
					_tempQuaternion.multiplyQuaternions( _tempQuaternion2, _tempQuaternion );
					handle.quaternion.copy( _tempQuaternion );

				}

				if ( handle.name === 'Z' ) {

					_tempQuaternion.setFromAxisAngle( _unitZ, Math.atan2( _alignVector.y, _alignVector.x ) );
					_tempQuaternion.multiplyQuaternions( _tempQuaternion2, _tempQuaternion );
					handle.quaternion.copy( _tempQuaternion );

				}

			}

			// Hide disabled axes
			handle.visible = handle.visible && ( handle.name.indexOf( 'X' ) === - 1 || this.showX );
			handle.visible = handle.visible && ( handle.name.indexOf( 'Y' ) === - 1 || this.showY );
			handle.visible = handle.visible && ( handle.name.indexOf( 'Z' ) === - 1 || this.showZ );
			handle.visible = handle.visible && ( handle.name.indexOf( 'E' ) === - 1 || ( this.showX && this.showY && this.showZ ) );

			// Hide disabled plane helpers
			handle.visible = handle.visible && ( handle.name.indexOf( 'XY' ) === - 1 || this.showXY );
			handle.visible = handle.visible && ( handle.name.indexOf( 'YZ' ) === - 1 || this.showYZ );
			handle.visible = handle.visible && ( handle.name.indexOf( 'XZ' ) === - 1 || this.showXZ );

			// Hide disabled rotation helpers
			handle.visible = handle.visible && ( handle.name !== 'E' || this.showE );
			handle.visible = handle.visible && ( handle.name !== 'XYZE' || this.showXYZE );

			// highlight selected axis

			handle.material._color = handle.material._color || handle.material.color.clone();
			handle.material._opacity = handle.material._opacity || handle.material.opacity;

			handle.material.color.copy( handle.material._color );
			handle.material.opacity = handle.material._opacity;

			// Translate and rotate handles reuse the same 'X'/'Y'/'Z' names, so gate
			// highlighting by family too -- otherwise grabbing the translate-X arrow
			// would also light up the unrelated rotate-X ring.
			if ( this.enabled && this.axis && handle.family === this.mode ) {

				if ( handle.name === this.axis ) {

					handle.material.color.copy( this.materialLib.active.color );
					handle.material.opacity = 1.0;

				} else if ( this.axis.split( '' ).some( function ( a ) {

					return handle.name === a;

				} ) ) {

					handle.material.color.copy( this.materialLib.active.color );
					handle.material.opacity = 1.0;

				}

			}

		}

		super.updateMatrixWorld( force );

	}

}

//

class TransformControlsPlane extends Mesh {

	constructor() {

		super(
			new PlaneGeometry( 100000, 100000, 2, 2 ),
			new MeshBasicMaterial( { visible: false, wireframe: true, side: DoubleSide, transparent: true, opacity: 0.1, toneMapped: false } )
		);

		this.isTransformControlsPlane = true;

		this.type = 'TransformControlsPlane';

	}

	updateMatrixWorld( force ) {

		let space = this.space;

		this.position.copy( this.worldPosition );

		if ( this.mode === 'scale' ) space = 'local'; // scale always oriented to local rotation

		_v1.copy( _unitX ).applyQuaternion( space === 'local' ? this.worldQuaternion : _identityQuaternion );
		_v2.copy( _unitY ).applyQuaternion( space === 'local' ? this.worldQuaternion : _identityQuaternion );
		_v3.copy( _unitZ ).applyQuaternion( space === 'local' ? this.worldQuaternion : _identityQuaternion );

		// Align the plane for current transform mode, axis and space.

		_alignVector.copy( _v2 );

		switch ( this.mode ) {

			case 'translate':
			case 'scale':
				switch ( this.axis ) {

					case 'X':
						_alignVector.copy( this.eye ).cross( _v1 );
						_dirVector.copy( _v1 ).cross( _alignVector );
						break;
					case 'Y':
						_alignVector.copy( this.eye ).cross( _v2 );
						_dirVector.copy( _v2 ).cross( _alignVector );
						break;
					case 'Z':
						_alignVector.copy( this.eye ).cross( _v3 );
						_dirVector.copy( _v3 ).cross( _alignVector );
						break;
					case 'XY':
						_dirVector.copy( _v3 );
						break;
					case 'YZ':
						_dirVector.copy( _v1 );
						break;
					case 'XZ':
						_alignVector.copy( _v3 );
						_dirVector.copy( _v2 );
						break;
					case 'XYZ':
					case 'E':
						_dirVector.set( 0, 0, 0 );
						break;

				}

				break;
			case 'rotate':
			default:
				// special case for rotate
				_dirVector.set( 0, 0, 0 );

		}

		if ( _dirVector.length() === 0 ) {

			// If in rotate mode, make the plane parallel to camera
			this.quaternion.copy( this.cameraQuaternion );

		} else {

			_tempMatrix.lookAt( _tempVector.set( 0, 0, 0 ), _dirVector, _alignVector );

			this.quaternion.setFromRotationMatrix( _tempMatrix );

		}

		super.updateMatrixWorld( force );

	}

}

export { TransformControls, TransformControlsGizmo, TransformControlsPlane };
