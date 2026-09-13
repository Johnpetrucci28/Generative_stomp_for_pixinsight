#engine v8

#feature-id    IAStamp : IA stamp > Generative Stamp
#feature-info  Paint over a region and regenerate it with a local generative inpainting model (LaMa) or a classical fallback.

/*
 * IA stamp -- intelligent generative stamp for PixInsight.
 *
 * Paint over a region of the active view with the brush (drag with the
 * left button to add, hold Ctrl while dragging to subtract from the
 * selection, Ctrl+right-click-drag to resize the brush), click
 * "Tamponner": the script extracts that crop (in LINEAR data) from an
 * internal WORKING COPY of the image -- not the real view -- hands it to
 * a local Python process (LaMa, Apache 2.0, or a classical OpenCV
 * fallback -- see LICENSES.md, next to this file) via PixInsight's
 * ExternalProcess, and
 * writes the regenerated result back into that working copy. Nothing
 * touches the real image until "Appliquer a l'image" is clicked, which
 * commits the whole working copy in one shot, wrapped in
 * View.beginProcess(UndoFlag.PixelData)/endProcess() -- one single,
 * Ctrl+Z-undoable step for the whole session. (An earlier version of this
 * script committed every stamp directly and immediately, to feel closer
 * to a native interactive tool -- reverted on request: for a script
 * that's staying a script (see the ProcessInterface note below for why a
 * true native process isn't reachable from PJSR anyway), the stage/review/
 * apply workflow is the better fit, and it plays nicer with a script
 * dialog that's modal and so can't rely on PixInsight's own Ctrl+Z being
 * reachable mid-session anyway.)
 *
 * Because that final commit only ever calls Image.assign() on the view's
 * PRE-EXISTING image object (pixel data only, never touching RGBWS/ICC
 * profile/FITS keywords/astrometric solution, and never re-creating the
 * window), the file's format, bit depth, and any FITS headers or
 * astrometric solution are left exactly as they were.
 *
 * NOTE on scope: PJSR (PixInsight's scripting API) has no way to hook
 * mouse events on a real ImageWindow/View's own viewport -- confirmed
 * against the local docs (no onMouse* handlers documented on either
 * class) and against every bundled community script on this machine
 * (none does it either). That level of "real interactive tool" behavior
 * (like the built-in CloneStamp) is a compiled C++ PCL module
 * (ProcessInterface), a completely different and much larger project
 * than a .js script -- confirmed this still holds on 1.9.4 "Lockhart"
 * despite its SpiderMonkey-to-V8 scripting engine swap (a JS *engine*
 * change, unrelated to what the PJSR *API surface* exposes). What this
 * script CAN do, and does: brush interaction on this dialog's own canvas
 * (unavoidable), editing a working copy reviewed before it ever touches
 * the real image.
 *
 * PJSR (this script's own language) cannot run PyTorch/LaMa itself --
 * that's the one part of this tool that has to leave PixInsight, via a
 * plain subprocess call exchanging single-channel FITS files on disk.
 *
 * First-time setup: normally none -- python.exe and cli_stamp.py are
 * auto-located from this script's own position (see IASTAMP_AUTO_*
 * below). The "..." buttons are only a fallback if that auto-detection
 * doesn't match your setup.
 *
 * NOTE: PJSR API calls were checked against PixInsight's own local
 * documentation (doc/pjsr/objects/*) and against real, shipped community
 * scripts (src/scripts/CosmicClarity_SASpro.js for the ExternalProcess
 * pattern, src/scripts/BlemishBlaster.js for the paint-canvas/zoom
 * pattern, src/scripts/NBRGBCombination.js for the AutoSTF math,
 * src/scripts/AstroMarkSignatureAdder.js for the New-Instance/Parameters
 * pattern, src/scripts/AdP/MosaicPlanner.js for #__FILE__) -- several
 * real bugs were already found and fixed by actually running it. Treat
 * any further change here as needing a real in-app test too.
 */

CoreApplication.ensureMinimumVersion( 1, 9, 4 );

// No #include lines on purpose: PixInsight's script host pre-loads the
// standard pjsr headers before running any script, and at least
// Sizer.jsh isn't safe to include twice ("Identifier 'HorizontalSizer'
// has already been declared") -- confirmed by an actual run.

#define SETTINGS_PREFIX "IAStamp/"
#define PAD_PX          64
#define MIN_CROP_PX     256
#define VIEWPORT_W      900
#define VIEWPORT_H      620
#define MIN_SCALE       0.02
#define MAX_SCALE       8
#define ZOOM_STEP       1.25

// This script's own directory (e.g. ".../pixinsight"), from the #__FILE__
// preprocessor macro -- lets python.exe/cli_stamp.py be found
// automatically instead of the user having to browse to them. Everything
// this script needs (besides Python itself) lives under this same
// "pixinsight" folder, so the whole folder is self-contained and can be
// copied/shared as a unit -- see README.md alongside this file.
#define IASTAMP_SCRIPT_DIR ( File.extractDrive( #__FILE__ ) + File.extractDirectory( #__FILE__ ) )
#define IASTAMP_AUTO_CLI ( IASTAMP_SCRIPT_DIR + "/python/stamp/cli_stamp.py" )

// python.exe/python3 isn't shipped in the folder (a full Python install,
// and several GB once torch/LaMa are installed) -- tried in order: (1) a
// venv the user set up themselves right inside this shared folder (the
// self-contained way to share/run this tool elsewhere, see README.md),
// checked under both its Windows layout (venv/Scripts/python.exe) and its
// macOS/Linux layout (venv/bin/python3), (2) this developer machine's
// existing HaloNet venv, same two layouts, kept so the original setup this
// was built against keeps working with zero reconfiguration. Falls back to
// "" (wrench button) if none exist.
function iastampAutoDetectPython()
{
   var candidates = [
      IASTAMP_SCRIPT_DIR + "/python/venv/Scripts/python.exe",
      IASTAMP_SCRIPT_DIR + "/python/venv/bin/python3",
      IASTAMP_SCRIPT_DIR + "/../../.venv/Scripts/python.exe",
      IASTAMP_SCRIPT_DIR + "/../../.venv/bin/python3"
   ];
   for ( var i = 0; i < candidates.length; ++i )
      if ( File.exists( candidates[i] ) )
         return candidates[i];
   return "";
}

// ============================================================================
// Persisted configuration (Python + CLI script paths -- auto-detected by
// default, see IASTAMP_AUTO_* above; only overridden if the user explicitly
// browses to a different path, which is then remembered for next time)
// ============================================================================

function iastampLoadSetting( key, defaultValue )
{
   var v = Settings.read( SETTINGS_PREFIX + key, DataType.UTF16String );
   return ( v && v.length > 0 ) ? v : defaultValue;
}

function iastampSaveSetting( key, value )
{
   Settings.write( SETTINGS_PREFIX + key, DataType.UTF16String, value );
}

// ============================================================================
// External process (adapted from the pattern used by the bundled
// CosmicClarity_SASpro.js script for calling an external AI backend)
// ============================================================================

function iastampRunExternalProcessBlocking( program, args )
{
   var process = new ExternalProcess;
   var stdoutText = "", stderrText = "";

   process.onStandardOutputDataAvailable = () => { stdoutText += String( process.stdout ); };
   process.onStandardErrorDataAvailable  = () => { stderrText += String( process.stderr ); };

   if ( !process.start( program, args ) )
      return { ok: false, stdout: stdoutText, stderr: "Failed to start process: " + program };

   while ( process.isStarting ) CoreApplication.processEvents();
   while ( process.isRunning )  CoreApplication.processEvents();

   return { ok: process.exitCode === 0, exitCode: process.exitCode, stdout: stdoutText, stderr: stderrText };
}

function iastampMsleep( ms )
{
   var t0 = new Date().getTime();
   while ( new Date().getTime() - t0 < ms )
      CoreApplication.processEvents();
}

function iastampOpenImageWithRetries( path, attempts, delayMs )
{
   var lastError = "";
   for ( var i = 0; i < attempts; ++i )
   {
      try
      {
         var opened = ImageWindow.open( path );
         if ( opened && opened.length > 0 )
            return opened[0];
         lastError = "ImageWindow.open() returned no windows.";
      }
      catch ( e ) { lastError = e.message; }
      if ( i < attempts - 1 )
         iastampMsleep( delayMs );
   }
   throw new Error( "Could not open result file: " + path + " (" + lastError + ")" );
}

// ============================================================================
// Temp files
// ============================================================================

function iastampTempDir()
{
   var dir = File.systemTempDirectory + "/IAStamp";
   if ( !File.directoryExists( dir ) )
      File.createDirectory( dir );
   return dir;
}

function iastampUniqueBase()
{
   return iastampTempDir() + "/" + new Date().getTime();
}

function iastampSaveChannelAsFits( samples, w, h, path )
{
   var win = new ImageWindow( w, h, 1, 32, true, false, "iastamp_tmp" );
   win.mainView.beginProcess( UndoFlag.NoSwapFile );
   win.mainView.image.setSamples( samples, new Rect( 0, 0, w, h ), 0 );
   win.mainView.endProcess();
   var ok = win.saveAs( path, false, false, false, false );
   win.forceClose();
   if ( !ok )
      throw new Error( "Failed to write temp FITS: " + path );
}

// ============================================================================
// Auto STF, ported faithfully from src/scripts/AdP/AutoStretch.js -- a
// script explicitly attributed to Juan Conejero (PixInsight's own lead
// developer): "copied and simplified from the AutoSTF script from Juan
// Conejero". This replaced an earlier hand-rolled version that had THREE
// real bugs, only found by comparing against this authoritative source:
//   1. `Math.mtf(m, x)` is a FORWARD-only function (the midtones curve
//      value at x, given m) -- it is NOT a solver. An earlier version
//      called Math.mtf(target, excess) expecting it to return the m that
//      achieves target, which is not what it computes at all.
//   2. HistogramTransformation.H's real per-channel order is
//      [c0, m, c1, r0, r1] -- not [c0, c1, m, ...] (STF's own order) and
//      not the swapped order the bundled NBRGBCombination.js script uses
//      (copied from there originally, apparently wrong or a different
//      convention that happens to work in that script's own flow).
//   3. H needs 5 rows (R, G, B, K, L), not 4 -- the L (luminance) row was
//      missing entirely.
// iastampFindMidtonesBalance() is Conejero's own bisection solver for the
// midtones balance, kept as its own function on purpose.
//
// IMPORTANT (still true): ScreenTransferFunction.executeOn() only sets a
// display setting on a real PixInsight window's own screen widget --
// Image.render() (what this script uses to build its preview Bitmap)
// completely ignores it and always rasterizes raw linear data. That's why
// this bakes the stretch into real pixel data of a disposable clone via
// HistogramTransformation (see iastampRebuildPreview() below) instead.
// ============================================================================

#define IASTAMP_STF_SHADOWS_CLIP -1.25 // PixInsight's own real AutoSTF default (doc/tools/ScreenTransferFunction)
#define IASTAMP_STF_TARGET_BKG    0.25

function iastampFindMidtonesBalance( v0, v1, eps )
{
   if ( v1 <= 0 ) return 0;
   if ( v1 >= 1 ) return 1;
   v0 = Math.range( v0, 0.0, 1.0 );
   eps = eps ? Math.max( 1.0e-15, eps ) : 5.0e-05;

   var m0, m1;
   if ( v1 < v0 ) { m0 = 0; m1 = 0.5; }
   else           { m0 = 0.5; m1 = 1; }

   for ( ;; )
   {
      var m = (m0 + m1) / 2;
      var v = Math.mtf( m, v1 );
      if ( Math.abs( v - v0 ) < eps )
         return m;
      if ( v < v0 )
         m1 = m;
      else
         m0 = m;
   }
}

// Returns one [c0, m, c1, r0, r1] tuple per channel (length 1 for mono, 3
// for color) -- already in HistogramTransformation.H's real field order.
function iastampComputeAutoStf( image )
{
   var n = image.isColor ? 3 : 1;
   var result = [];
   for ( var c = 0; c < n; ++c )
   {
      image.selectedChannel = c;
      var median = image.median();
      var avgDev = image.avgDev();
      image.resetSelections();

      var c0 = Math.range( median + IASTAMP_STF_SHADOWS_CLIP * avgDev, 0.0, 1.0 );
      var m = iastampFindMidtonesBalance( IASTAMP_STF_TARGET_BKG, median - c0 );
      result.push( [ c0, m, 1, 0, 1 ] );
   }
   return result;
}

// dialog.previewWindow always holds what the viewport actually renders: a
// disposable clone of the WORKING COPY's current pixel data (dialog.
// workingWindow -- not the real view, and not itself editable), stretched
// via HistogramTransformation with a freshly computed AutoSTF (see
// iastampComputeAutoStf() above), or a plain untouched copy when STF is
// off. Purely a display convenience (Image.render() can't honor View.stf
// directly, see the note above iastampComputeAutoStf) -- rebuilt after
// every stamp/undo. H's 5 rows are [R, G, B, K, L] in
// [c0, m, c1, r0, r1] order per row (see AdP/AutoStretch.js's HardApply,
// the ground truth this was ported from): mono images put their one
// computed stretch in the K row (index 3) and leave R/G/B/L at identity;
// color images put one stretch per channel in R/G/B and leave K/L at
// identity.
function iastampRebuildPreview( dialog )
{
   var src = dialog.workingWindow.mainView.image;
   if ( !dialog.previewWindow )
      dialog.previewWindow = new ImageWindow( src.width, src.height, src.numberOfChannels, 32, true, src.isColor, "iastamp_preview" );

   var v = dialog.previewWindow.mainView;
   v.beginProcess( UndoFlag.NoSwapFile );
   v.image.assign( src );
   v.endProcess();

   if ( dialog.stfEnabled )
   {
      var stf;
      try { stf = iastampComputeAutoStf( src ); }
      catch ( e ) { stf = null; }

      if ( stf )
      {
         var IDENTITY = [ 0, 0.5, 1, 0, 1 ];
         var HT = new HistogramTransformation;
         if ( src.isColor )
            HT.H = [ stf[0], stf[1], stf[2], IDENTITY, IDENTITY ];
         else
            HT.H = [ IDENTITY, IDENTITY, IDENTITY, stf[0], IDENTITY ];
         HT.executeOn( v, false );
      }
   }

   return dialog.previewWindow.mainView.image;
}

// ============================================================================
// Mask rasterization: brush strokes (image-space {x,y,radius,mode} points,
// mode "add" or "sub", applied in paint order so later strokes win where
// they overlap earlier ones) -> a Float64Array over the crop bbox.
// ============================================================================

function iastampStrokesBBox( strokes, imgW, imgH )
{
   var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
   for ( var i = 0; i < strokes.length; ++i )
   {
      var s = strokes[i];
      minX = Math.min( minX, s.x - s.radius ); maxX = Math.max( maxX, s.x + s.radius );
      minY = Math.min( minY, s.y - s.radius ); maxY = Math.max( maxY, s.y + s.radius );
   }
   var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
   // Pad proportionally to the painted extent (not just a fixed margin) so
   // the model sees enough real surrounding context to continue a gradient,
   // filament, or diffraction spike that crosses the masked area -- a fixed
   // small pad leaves it almost no context to work with on a big brush.
   var extent = Math.max( maxX - minX, maxY - minY );
   var pad = Math.max( PAD_PX, extent * 0.5 );
   var halfW = Math.max( (maxX - minX) / 2 + pad, MIN_CROP_PX / 2 );
   var halfH = Math.max( (maxY - minY) / 2 + pad, MIN_CROP_PX / 2 );
   var x0 = Math.max( 0, Math.round( cx - halfW ) );
   var y0 = Math.max( 0, Math.round( cy - halfH ) );
   var x1 = Math.min( imgW, Math.round( cx + halfW ) );
   var y1 = Math.min( imgH, Math.round( cy + halfH ) );
   return new Rect( x0, y0, x1, y1 );
}

function iastampRasterizeMask( strokes, rect )
{
   var w = rect.width, h = rect.height;
   var mask = new Float64Array( w * h );
   for ( var i = 0; i < strokes.length; ++i )
   {
      var s = strokes[i];
      var val = ( s.mode === "sub" ) ? 0 : 1;
      var lx = s.x - rect.x0, ly = s.y - rect.y0, rad2 = s.radius * s.radius;
      var xMin = Math.max( 0, Math.floor( lx - s.radius ) ), xMax = Math.min( w - 1, Math.ceil( lx + s.radius ) );
      var yMin = Math.max( 0, Math.floor( ly - s.radius ) ), yMax = Math.min( h - 1, Math.ceil( ly + s.radius ) );
      for ( var y = yMin; y <= yMax; ++y )
      {
         var dy = y - ly, rowBase = y * w;
         for ( var x = xMin; x <= xMax; ++x )
         {
            var dx = x - lx;
            if ( dx * dx + dy * dy <= rad2 )
               mask[rowBase + x] = val;
         }
      }
   }
   return mask;
}

// ============================================================================
// Paint viewport: a scrollable/zoomable canvas showing the image's current
// rendered appearance (whatever STF/stretch the user already has active).
// Left-drag paints (adds to the selection); Ctrl+left-drag erases from it;
// mouse wheel zooms, anchored on the cursor. A hollow circle always tracks
// the cursor at the current brush size; it's the strokes themselves (drawn
// filled) that show what's actually selected while dragging.
// ============================================================================

var StampViewport = class extends ScrollBox
{
   constructor( parent, dialog )
   {
      super( parent );
      this.ownerDialog = dialog; // NB: "dialog" itself is a read-only built-in Control property
      this.autoScroll = true;
      this.tracking = true; // let onMouseMove fire with no button held, for the hover ring
      this.image = null;
      this.imgW = 0; this.imgH = 0;
      this.scale = 1;
      this.strokes = [];
      this.painting = false;
      this.resizingBrush = false;
      this.resizeStartX = 0;
      this.resizeStartRadius = 0;
      this.hovering = false;
      this.hoverX = 0; this.hoverY = 0;
      this._cachedBitmap = null;
      this.scrollPosition = new Point( 0, 0 );

      this.setFixedSize( VIEWPORT_W, VIEWPORT_H );
      this.viewport.cursor = new Cursor( StdCursor.Cross );
      this.viewport.mouseTracking = true; // belt-and-braces alongside this.tracking above

      this.viewport.onResize = () => { this.updateScrollRange(); };
      this.onHorizontalScrollPosUpdated = () => { this.viewport.update(); };
      this.onVerticalScrollPosUpdated   = () => { this.viewport.update(); };

      this.viewport.onMousePress = ( x, y, button, buttons, modifiers ) =>
      {
         // Ctrl + right-click-drag: live brush diameter adjustment (checked
         // before the left-button paint path below -- button 2 = Right).
         if ( button === 2 && ( modifiers & 4 ) )
         {
            this.resizingBrush = true;
            this.resizeStartX = x;
            this.resizeStartRadius = this.ownerDialog.brushRadiusControl.value;
            return;
         }
         if ( button !== 1 ) return; // MouseButton_Left (ButtonCodes.jsh) -- no #include, see note above
         this.painting = true;
         this.addStroke( x, y, modifiers );
      };

      this.viewport.onMouseMove = ( x, y, buttons, modifiers ) =>
      {
         this.hovering = true;
         this.hoverX = x; this.hoverY = y;
         if ( this.resizingBrush )
         {
            var delta = ( x - this.resizeStartX ) / this.scale;
            var newRadius = Math.max( 3, Math.min( 300, Math.round( this.resizeStartRadius + delta ) ) );
            this.ownerDialog.brushRadiusControl.setValue( newRadius );
            this.viewport.update();
            return;
         }
         if ( this.painting )
            this.addStroke( x, y, modifiers );
         else
            this.viewport.update();
      };

      this.viewport.onMouseRelease = ( x, y, button, buttons, modifiers ) =>
      {
         if ( button === 2 ) this.resizingBrush = false;
         this.painting = false;
      };

      this.viewport.onEnter = () => { this.hovering = true; };
      this.viewport.onLeave = () => { this.hovering = false; this.viewport.update(); };

      this.viewport.onMouseWheel = ( x, y, delta, buttons, modifiers ) =>
      {
         var factor = ( delta > 0 ) ? 1 / ZOOM_STEP : ZOOM_STEP;
         this.setScale( this.scale * factor, new Point( x, y ) );
      };

      this.viewport.onPaint = ( x0, y0, x1, y1 ) =>
      {
         var g = new Graphics( this.viewport );
         g.fillRect( x0, y0, x1, y1, new Brush( 0xff202020 ) );
         if ( this.image )
         {
            if ( !this._cachedBitmap )
               this._cachedBitmap = this.image.render( 1, false );

            g.scaleTransformation( this.scale );
            g.translateTransformation( -this.scrollPosition.x / this.scale, -this.scrollPosition.y / this.scale );
            g.drawBitmap( 0, 0, this._cachedBitmap );
            g.resetTransformation();

            this.drawOverlay( g );
         }
         g.end();
      };
   }

   // Screen (viewport-local) coordinates -> full-resolution image coordinates.
   screenToImage( sx, sy )
   {
      return { x: (sx + this.scrollPosition.x) / this.scale, y: (sy + this.scrollPosition.y) / this.scale };
   }

   drawOverlay( g )
   {
      var haveStrokes = this.strokes.length > 0;
      var showHoverRing = this.hovering && !this.painting;
      if ( !haveStrokes && !showHoverRing ) return;

      var maskBmp = new Bitmap( this.viewport.width, this.viewport.height );
      maskBmp.fill( 0x00000000 );
      var mg = new Graphics( maskBmp );
      mg.antialiasing = true;
      mg.pen = new Pen( 0x00000000 );
      mg.scaleTransformation( this.scale );
      mg.translateTransformation( -this.scrollPosition.x / this.scale, -this.scrollPosition.y / this.scale );

      for ( var i = 0; i < this.strokes.length; ++i )
      {
         var s = this.strokes[i];
         mg.compositionOperator = ( s.mode === "sub" ) ? 0 /* Clear */ : 3 /* SourceOver */;
         mg.brush = new Brush( 0x80ff3020 );
         mg.fillCircle( s.x, s.y, s.radius );
      }
      mg.end();
      g.drawBitmap( 0, 0, maskBmp );

      if ( showHoverRing )
      {
         var brushRadius = this.ownerDialog.brushRadiusControl.value;
         var p = this.screenToImage( this.hoverX, this.hoverY );
         g.antialiasing = true;
         g.pen = new Pen( 0xffffe040, 1 );
         g.scaleTransformation( this.scale );
         g.translateTransformation( -this.scrollPosition.x / this.scale, -this.scrollPosition.y / this.scale );
         g.drawCircle( p.x, p.y, brushRadius );
         g.resetTransformation();
      }
   }

   addStroke( screenX, screenY, modifiers )
   {
      var mode = ( modifiers & 4 ) ? "sub" : "add"; // Ctrl -- see note near onMousePress
      var brushRadius = this.ownerDialog.brushRadiusControl.value;
      var p = this.screenToImage( screenX, screenY );
      // Throttle: only add a point if it moved enough to matter, otherwise
      // a single slow drag can produce thousands of near-identical points.
      var last = this.strokes[this.strokes.length - 1];
      if ( last && last.mode === mode )
      {
         var dx = p.x - last.x, dy = p.y - last.y;
         if ( dx * dx + dy * dy < (brushRadius * 0.3) * (brushRadius * 0.3) )
            return;
      }
      this.strokes.push( { x: p.x, y: p.y, radius: brushRadius, mode: mode } );
      this.viewport.update();
   }

   clearStrokes()
   {
      this.strokes = [];
      this.viewport.update();
   }

   updateScrollRange()
   {
      var contentW = this.imgW * this.scale, contentH = this.imgH * this.scale;
      var maxX = Math.max( 0, Math.round( contentW - this.viewport.width ) );
      var maxY = Math.max( 0, Math.round( contentH - this.viewport.height ) );
      this.setHorizontalScrollRange( 0, maxX );
      this.setVerticalScrollRange( 0, maxY );
      this.scrollPosition = new Point(
         Math.max( 0, Math.min( this.scrollPosition.x, maxX ) ),
         Math.max( 0, Math.min( this.scrollPosition.y, maxY ) )
      );
   }

   setScale( newScale, refPoint )
   {
      newScale = Math.max( MIN_SCALE, Math.min( MAX_SCALE, newScale ) );
      if ( Math.abs( newScale - this.scale ) < 1e-6 ) return;
      if ( !refPoint ) refPoint = new Point( this.viewport.width / 2, this.viewport.height / 2 );
      var anchor = this.screenToImage( refPoint.x, refPoint.y );
      this.scale = newScale;
      this.updateScrollRange();
      this.scrollPosition = new Point( anchor.x * this.scale - refPoint.x, anchor.y * this.scale - refPoint.y );
      this.updateScrollRange(); // re-clamp with the just-set position
      this.viewport.update();
   }

   zoomIn()  { this.setScale( this.scale * ZOOM_STEP ); }
   zoomOut() { this.setScale( this.scale / ZOOM_STEP ); }

   zoomToFit()
   {
      this.setScale( Math.min( 1, VIEWPORT_W / this.imgW, VIEWPORT_H / this.imgH ) );
   }

   // Call after the underlying image's PIXELS changed (a stamp was applied
   // or undone) -- keeps the current zoom/pan, just re-renders.
   refreshBitmap()
   {
      this._cachedBitmap = null;
      this.viewport.update();
   }

   setImage( image, imgW, imgH )
   {
      this.image = image;
      this.imgW = imgW; this.imgH = imgH;
      this._cachedBitmap = null;
      this.scrollPosition = new Point( 0, 0 );
      this.zoomToFit();
   }
};

// ============================================================================
// Config sub-dialog: python.exe / cli_stamp.py paths, tucked behind the
// wrench button on the main dialog (same convention several bundled
// scripts use, e.g. Toolbox/GraXpertDenoise.js's setup_Button) instead of
// always showing these rarely-touched fields on the main dialog.
// ============================================================================

var IAStampConfigDialog = class extends Dialog
{
   constructor( owner )
   {
      super();
      this.owner = owner;
      this.windowTitle = "IA stamp -- configuration";

      this.pythonEdit = new Edit( this );
      this.pythonEdit.text = owner.pythonExe;
      this.pythonEdit.toolTip = "Chemin vers python.exe (idealement un venv dans pixinsight/python/venv/, voir README.md).";
      this.pythonEdit.onEditCompleted = () => { owner.pythonExe = this.pythonEdit.text; iastampSaveSetting( "pythonExe", owner.pythonExe ); };

      this.pythonBrowse = new ToolButton( this );
      this.pythonBrowse.text = "...";
      this.pythonBrowse.onClick = () =>
      {
         var ofd = new OpenFileDialog;
         ofd.caption = "Localiser python.exe";
         ofd.filters = [["Executable", "*.exe"]];
         if ( ofd.execute() )
         {
            owner.pythonExe = ofd.filePath;
            this.pythonEdit.text = owner.pythonExe;
            iastampSaveSetting( "pythonExe", owner.pythonExe );
         }
      };

      this.cliEdit = new Edit( this );
      this.cliEdit.text = owner.cliScript;
      this.cliEdit.toolTip = "Chemin vers pixinsight/python/stamp/cli_stamp.py";
      this.cliEdit.onEditCompleted = () => { owner.cliScript = this.cliEdit.text; iastampSaveSetting( "cliScript", owner.cliScript ); };

      this.cliBrowse = new ToolButton( this );
      this.cliBrowse.text = "...";
      this.cliBrowse.onClick = () =>
      {
         var ofd = new OpenFileDialog;
         ofd.caption = "Localiser cli_stamp.py";
         ofd.filters = [["Python", "*.py"]];
         if ( ofd.execute() )
         {
            owner.cliScript = ofd.filePath;
            this.cliEdit.text = owner.cliScript;
            iastampSaveSetting( "cliScript", owner.cliScript );
         }
      };

      var pythonSizer = new HorizontalSizer;
      pythonSizer.spacing = 4;
      pythonSizer.add( this.pythonEdit, 100 );
      pythonSizer.add( this.pythonBrowse );

      var cliSizer = new HorizontalSizer;
      cliSizer.spacing = 4;
      cliSizer.add( this.cliEdit, 100 );
      cliSizer.add( this.cliBrowse );

      this.closeButton = new PushButton( this );
      this.closeButton.text = "Fermer";
      this.closeButton.onClick = () => { this.ok(); };

      var closeSizer = new HorizontalSizer;
      closeSizer.addStretch();
      closeSizer.add( this.closeButton );

      this.sizer = new VerticalSizer;
      this.sizer.margin = 8;
      this.sizer.spacing = 6;
      this.sizer.add( new Label( this ) ).text = "python.exe:";
      this.sizer.add( pythonSizer );
      this.sizer.addSpacing( 6 );
      this.sizer.add( new Label( this ) ).text = "cli_stamp.py:";
      this.sizer.add( cliSizer );
      this.sizer.addSpacing( 8 );
      this.sizer.add( closeSizer );

      this.adjustToContents();
      this.setFixedHeight( this.height );
   }
};

// ============================================================================
// Main dialog
// ============================================================================

var IAStampDialog = class extends Dialog
{
   constructor()
   {
      super();
      this.windowTitle = "IA stamp -- tampon generatif";

      var window = ImageWindow.activeWindow;
      if ( window.isNull )
         throw new Error( "Aucune image active. Ouvre une image dans PixInsight d'abord." );
      this.view = ( window.currentView && !window.currentView.isNull ) ? window.currentView : window.mainView;
      var img = this.view.image;

      // Working copy: every "Tamponner" reads/writes only this, never the
      // real view, until "Appliquer a l'image" commits it all at once.
      this.workingWindow = new ImageWindow( img.width, img.height, img.numberOfChannels, 32, true, img.isColor, "iastamp_working" );
      this.workingWindow.mainView.beginProcess( UndoFlag.NoSwapFile );
      this.workingWindow.mainView.image.assign( img );
      this.workingWindow.mainView.endProcess();

      this.previewWindow = null; // built by iastampRebuildPreview() below -- STF-baked display clone only, never edited directly
      this.stfEnabled = true;
      this.lastStampSnapshot = null; // set by doStamp(), consumed by undoLastStamp()
      this.stampCount = 0; // > 0 means unapplied changes sit in workingWindow

      // Auto-detected from this script's own location by default (see
      // IASTAMP_AUTO_* above) -- only overridden if a Settings value from an
      // earlier manual "..." browse exists AND that path still exists.
      var autoCli = File.exists( IASTAMP_AUTO_CLI ) ? IASTAMP_AUTO_CLI : "";
      var autoPython = iastampAutoDetectPython();
      this.pythonExe = iastampLoadSetting( "pythonExe", autoPython );
      this.cliScript = iastampLoadSetting( "cliScript", autoCli );
      if ( this.pythonExe && !File.exists( this.pythonExe ) ) this.pythonExe = autoPython;
      if ( this.cliScript && !File.exists( this.cliScript ) ) this.cliScript = autoCli;
      this.engine = "lama";

      // -- config row -----------------------------------------------------
      // Drag this to the workspace to get a PixInsight process icon that
      // reopens this dialog with the current sliders/engine remembered
      // (Dialog.newInstance() + Parameters, the same mechanism regular
      // processes use -- see exportParameters()/importParameters() below).
      this.newInstanceButton = new ToolButton( this );
      this.newInstanceButton.icon = this.scaledResource( ":/process-interface/new-instance.png" );
      this.newInstanceButton.setScaledFixedSize( 24, 24 );
      this.newInstanceButton.toolTip = "Glisser vers l'espace de travail pour creer une icone de processus (memorise les reglages actuels).";
      this.newInstanceButton.onMousePress = () =>
      {
         this.exportParameters();
         this.newInstance();
      };

      // python.exe/cli_stamp.py paths are auto-detected (see IASTAMP_AUTO_*
      // above) and rarely need touching -- tucked behind this wrench button
      // instead of always showing on the main dialog (same convention as
      // Toolbox/GraXpertDenoise.js's setup_Button).
      this.configButton = new ToolButton( this );
      this.configButton.icon = this.scaledResource( ":/icons/wrench.png" );
      this.configButton.setScaledFixedSize( 24, 24 );
      this.configButton.toolTip = "Configurer les chemins python.exe / cli_stamp.py (auto-detectes par defaut).";
      this.configButton.onClick = () => { new IAStampConfigDialog( this ).execute(); };

      var configSizer = new HorizontalSizer;
      configSizer.spacing = 4;
      configSizer.add( this.newInstanceButton );
      configSizer.add( this.configButton );

      // -- brush + engine + zoom row ----------------------------------------
      this.brushRadiusControl = new NumericControl( this );
      this.brushRadiusControl.label.text = "Pinceau:";
      this.brushRadiusControl.setRange( 3, 300 );
      this.brushRadiusControl.slider.setRange( 3, 300 );
      this.brushRadiusControl.setPrecision( 0 );
      this.brushRadiusControl.setValue( 25 );

      this.opacityControl = new NumericControl( this );
      this.opacityControl.label.text = "Opacite:";
      this.opacityControl.setRange( 0, 100 );
      this.opacityControl.slider.setRange( 0, 100 );
      this.opacityControl.setPrecision( 0 );
      this.opacityControl.setValue( 100 );
      this.opacityControl.toolTip = "Force du tampon -- en dessous de 100%, l'original transparait a travers le resultat genere.";

      this.featherControl = new NumericControl( this );
      this.featherControl.label.text = "Fondu (%):";
      this.featherControl.setRange( 0, 60 );
      this.featherControl.slider.setRange( 0, 60 );
      this.featherControl.setPrecision( 0 );
      this.featherControl.setValue( 25 );
      this.featherControl.toolTip = "Adoucissement du bord, en % du rayon de la zone peinte -- s'adapte automatiquement a la taille du tampon (un fondu en pixels fixes est parfait sur un petit point mais laisse un bord dur sur un grand). Au-dela de ~40%, le defaut d'origine peut recommencer a transparaitre au centre.";

      this.engineLama = new RadioButton( this );
      this.engineLama.text = "LaMa (generatif)";
      this.engineLama.checked = true;
      this.engineLama.onCheck = () => { this.engine = "lama"; };

      this.engineClassical = new RadioButton( this );
      this.engineClassical.text = "Classique (rapide)";
      this.engineClassical.onCheck = () => { this.engine = "classical"; };

      this.zoomOutButton = new ToolButton( this );
      this.zoomOutButton.text = "-";
      this.zoomOutButton.toolTip = "Zoom arriere (ou molette)";
      this.zoomOutButton.onClick = () => { this.viewport.zoomOut(); };

      this.zoomFitButton = new ToolButton( this );
      this.zoomFitButton.text = "Ajuster";
      this.zoomFitButton.onClick = () => { this.viewport.zoomToFit(); };

      this.zoomInButton = new ToolButton( this );
      this.zoomInButton.text = "+";
      this.zoomInButton.toolTip = "Zoom avant (ou molette)";
      this.zoomInButton.onClick = () => { this.viewport.zoomIn(); };

      this.clearButton = new PushButton( this );
      this.clearButton.text = "Effacer selection";
      this.clearButton.onClick = () => { this.viewport.clearStrokes(); };

      this.stfCheckBox = new CheckBox( this );
      this.stfCheckBox.text = "STF auto";
      this.stfCheckBox.checked = true;
      this.stfCheckBox.toolTip = "Calcule un auto-stretch pour l'apercu, que l'image reelle soit deja etiree ou non -- affichage seulement, ne change aucune donnee.";
      this.stfCheckBox.onCheck = ( checked ) =>
      {
         this.stfEnabled = checked;
         this.viewport.image = iastampRebuildPreview( this );
         this.viewport.refreshBitmap();
      };

      var toolsSizer = new HorizontalSizer;
      toolsSizer.spacing = 6;
      toolsSizer.add( this.brushRadiusControl, 100 );
      toolsSizer.addSpacing( 12 );
      toolsSizer.add( this.engineLama );
      toolsSizer.add( this.engineClassical );
      toolsSizer.addSpacing( 12 );
      toolsSizer.add( this.stfCheckBox );
      toolsSizer.addSpacing( 12 );
      toolsSizer.add( this.zoomOutButton );
      toolsSizer.add( this.zoomFitButton );
      toolsSizer.add( this.zoomInButton );
      toolsSizer.addStretch();
      toolsSizer.add( this.clearButton );

      var toolsSizer2 = new HorizontalSizer;
      toolsSizer2.spacing = 6;
      toolsSizer2.add( this.opacityControl, 100 );
      toolsSizer2.addSpacing( 12 );
      toolsSizer2.add( this.featherControl, 100 );

      // -- viewport ----------------------------------------------------------
      this.viewport = new StampViewport( this, this );
      this.viewport.setImage( iastampRebuildPreview( this ), img.width, img.height );

      var helpLabel = new Label( this );
      helpLabel.text = "Glisser: peindre -- Ctrl+glisser: retirer de la selection -- Ctrl+clic droit+glisser: ajuster le diametre du pinceau -- molette: zoom.";
      helpLabel.styleSheet = "color: #a0a0a0;";

      // -- status + action buttons -------------------------------------------
      this.statusLabel = new Label( this );
      this.statusLabel.text = "Peins une zone puis clique Tamponner (sur une copie de travail -- rien n'est applique a l'image avant \"Appliquer a l'image\").";
      this.statusLabel.textAlignment = TextAlignment.Left | TextAlignment.VertCenter;

      this.stampButton = new PushButton( this );
      this.stampButton.text = "Tamponner";
      this.stampButton.onClick = () => { this.doStamp(); };

      this.undoButton = new PushButton( this );
      this.undoButton.text = "Annuler dernier tampon";
      this.undoButton.enabled = false;
      this.undoButton.toolTip = "Annule uniquement le dernier tampon sur la copie de travail (un seul niveau).";
      this.undoButton.onClick = () => { this.undoLastStamp(); };

      this.applyButton = new PushButton( this );
      this.applyButton.text = "Appliquer a l'image";
      this.applyButton.enabled = false;
      this.applyButton.toolTip = "Valide tous les tampons de cette session sur l'image reelle, en un seul geste annulable (Ctrl+Z dans PixInsight).";
      this.applyButton.onClick = () => { this.applyToImage(); };

      this.closeButton = new PushButton( this );
      this.closeButton.text = "Fermer";
      this.closeButton.onClick = () => { this.closeDialog(); };

      var bottomSizer = new HorizontalSizer;
      bottomSizer.spacing = 6;
      bottomSizer.add( configSizer ); // New Instance + wrench, bottom-left -- usual PixInsight placement
      bottomSizer.addSpacing( 12 );
      bottomSizer.add( this.statusLabel, 100 );
      bottomSizer.add( this.stampButton );
      bottomSizer.add( this.undoButton );
      bottomSizer.add( this.applyButton );
      bottomSizer.add( this.closeButton );

      this.sizer = new VerticalSizer;
      this.sizer.margin = 8;
      this.sizer.spacing = 6;
      this.sizer.add( toolsSizer );
      this.sizer.add( toolsSizer2 );
      this.sizer.add( this.viewport );
      this.sizer.add( helpLabel );
      this.sizer.add( bottomSizer );

      this.importParameters();
      this.adjustToContents();
   }

   // Saved onto a dropped process icon by the "new instance" button; read
   // back here on construction if this dialog was launched from one.
   exportParameters()
   {
      Parameters.set( "brushRadius", this.brushRadiusControl.value );
      Parameters.set( "opacity", this.opacityControl.value );
      Parameters.set( "featherPct", this.featherControl.value );
      Parameters.set( "engine", this.engine );
      Parameters.set( "stfEnabled", this.stfEnabled );
   }

   importParameters()
   {
      if ( Parameters.has( "brushRadius" ) ) this.brushRadiusControl.setValue( Parameters.getReal( "brushRadius" ) );
      if ( Parameters.has( "opacity" ) ) this.opacityControl.setValue( Parameters.getReal( "opacity" ) );
      if ( Parameters.has( "featherPct" ) ) this.featherControl.setValue( Parameters.getReal( "featherPct" ) );
      if ( Parameters.has( "engine" ) )
      {
         this.engine = Parameters.getString( "engine" );
         this.engineLama.checked = this.engine === "lama";
         this.engineClassical.checked = this.engine === "classical";
      }
      if ( Parameters.has( "stfEnabled" ) )
      {
         var imported = Parameters.getBoolean( "stfEnabled" );
         if ( imported !== this.stfEnabled )
         {
            this.stfEnabled = imported;
            this.viewport.image = iastampRebuildPreview( this );
            this.viewport.refreshBitmap();
         }
         this.stfCheckBox.checked = this.stfEnabled;
      }
   }

   doStamp()
   {
      try
      {
         if ( !this.pythonExe || !File.exists( this.pythonExe ) )
            throw new Error( "Chemin python.exe invalide -- utilise le bouton \"...\"." );
         if ( !this.cliScript || !File.exists( this.cliScript ) )
            throw new Error( "Chemin cli_stamp.py invalide -- utilise le bouton \"...\"." );

         var strokes = this.viewport.strokes;
         if ( strokes.length === 0 || !strokes.some( s => s.mode !== "sub" ) )
         {
            new MessageBox( "Peins d'abord une zone a remplir.", "IA stamp", StdIcon.Information, StdButton.Ok ).execute();
            return;
         }

         this.stampButton.enabled = false;
         this.statusLabel.text = "Preparation...";
         CoreApplication.processEvents();

         var image = this.workingWindow.mainView.image;
         var rect = iastampStrokesBBox( strokes, image.width, image.height );
         var maskSamples = iastampRasterizeMask( strokes, rect );

         var base = iastampUniqueBase();
         var numChannels = image.numberOfChannels;
         var inPaths = [], outPaths = [];
         var preStampChannels = []; // kept for the in-dialog undo button, see below

         for ( var c = 0; c < numChannels; ++c )
         {
            var samples = new Float64Array( rect.width * rect.height );
            image.getSamples( samples, rect, c );
            preStampChannels.push( samples.slice() ); // .slice() copies -- samples itself gets no further writes, but be explicit
            var inPath = base + "_in_c" + c + ".fits";
            var outPath = base + "_out_c" + c + ".fits";
            iastampSaveChannelAsFits( samples, rect.width, rect.height, inPath );
            inPaths.push( inPath );
            outPaths.push( outPath );
         }

         var maskPath = base + "_mask.fits";
         iastampSaveChannelAsFits( maskSamples, rect.width, rect.height, maskPath );

         this.statusLabel.text = "Generation en cours (" + this.engine + ")...";
         CoreApplication.processEvents();

         var args = [
            this.cliScript,
            "--channels", inPaths.join( "," ),
            "--mask", maskPath,
            "--out-channels", outPaths.join( "," ),
            "--engine", this.engine,
            "--opacity", String( this.opacityControl.value / 100 ),
            "--feather-pct", String( this.featherControl.value )
         ];
         var result = iastampRunExternalProcessBlocking( this.pythonExe, args );
         if ( !result.ok || result.stdout.indexOf( "STAMP_OK" ) < 0 )
            throw new Error( "Echec du tampon:\n" + result.stderr );

         // Commit into the WORKING COPY only -- never the real view, until
         // "Appliquer a l'image" (see top-of-file note).
         this.workingWindow.mainView.beginProcess( UndoFlag.NoSwapFile );
         try
         {
            for ( var c = 0; c < numChannels; ++c )
            {
               var outWin = iastampOpenImageWithRetries( outPaths[c], 4, 500 );
               var outSamples = new Float64Array( rect.width * rect.height );
               outWin.mainView.image.getSamples( outSamples, new Rect( 0, 0, rect.width, rect.height ), 0 );
               outWin.forceClose();
               image.setSamples( outSamples, rect, c );
            }
         }
         finally { this.workingWindow.mainView.endProcess(); }

         // best-effort temp file cleanup
         for ( var c = 0; c < numChannels; ++c )
         {
            try { File.remove( inPaths[c] ); } catch ( e ) {}
            try { File.remove( outPaths[c] ); } catch ( e ) {}
         }
         try { File.remove( maskPath ); } catch ( e ) {}

         this.lastStampSnapshot = { rect: rect, channels: preStampChannels };
         this.undoButton.enabled = true;
         this.stampCount++;
         this.applyButton.enabled = true;

         this.viewport.clearStrokes();
         this.viewport.image = iastampRebuildPreview( this );
         this.viewport.refreshBitmap();
         this.statusLabel.text = "Tampon applique a la copie de travail -- clique \"Appliquer a l'image\" pour valider.";
      }
      catch ( e )
      {
         new MessageBox( String( e.message || e ), "IA stamp", StdIcon.Error, StdButton.Ok ).execute();
         this.statusLabel.text = "Erreur -- voir message.";
      }
      finally
      {
         this.stampButton.enabled = true;
      }
   }

   // Single-level undo, in-dialog: restores the pre-stamp pixels captured
   // in doStamp() straight into the working copy (not the real view).
   undoLastStamp()
   {
      var snap = this.lastStampSnapshot;
      if ( !snap ) return;
      this.workingWindow.mainView.beginProcess( UndoFlag.NoSwapFile );
      try
      {
         for ( var c = 0; c < snap.channels.length; ++c )
            this.workingWindow.mainView.image.setSamples( snap.channels[c], snap.rect, c );
      }
      finally { this.workingWindow.mainView.endProcess(); }
      this.lastStampSnapshot = null;
      this.undoButton.enabled = false;
      this.stampCount = Math.max( 0, this.stampCount - 1 );
      this.applyButton.enabled = this.stampCount > 0;
      this.viewport.image = iastampRebuildPreview( this );
      this.viewport.refreshBitmap();
      this.statusLabel.text = "Dernier tampon annule.";
   }

   applyToImage()
   {
      this.view.beginProcess( UndoFlag.PixelData );
      try { this.view.image.assign( this.workingWindow.mainView.image ); }
      finally { this.view.endProcess(); }
      this.lastStampSnapshot = null;
      this.stampCount = 0;
      this.undoButton.enabled = false;
      this.applyButton.enabled = false;
      this.statusLabel.text = "Applique a l'image (Ctrl+Z dans PixInsight pour tout annuler d'un coup).";
   }

   closeDialog()
   {
      if ( this.applyButton.enabled )
      {
         var mb = new MessageBox(
            "Des tampons n'ont pas ete appliques a l'image. Fermer quand meme et les perdre ?",
            "IA stamp", StdIcon.Warning, StdButton.Yes, StdButton.No
         );
         if ( mb.execute() !== StdButton.Yes )
            return;
      }
      this.workingWindow.forceClose();
      if ( this.previewWindow ) this.previewWindow.forceClose();
      this.ok();
   }
};

function iastampMain()
{
   try
   {
      var dialog = new IAStampDialog;
      dialog.execute();
   }
   catch ( e )
   {
      new MessageBox( String( e.message || e ), "IA stamp", StdIcon.Error, StdButton.Ok ).execute();
   }
}

iastampMain();
