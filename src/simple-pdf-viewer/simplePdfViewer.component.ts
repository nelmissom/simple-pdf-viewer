/**
 * Created by Viktor Hajer on 02/08/2018.
 */
import {Component, ElementRef, EventEmitter, Input, OnInit, Output} from '@angular/core';
import PDFDocumentProxy = PDF.PDFDocumentProxy;
import PDFPromise = PDF.PDFPromise;
import PDFProgressData = PDF.PDFProgressData;
import PDFPageProxy = PDF.PDFPageProxy;
import PDFPageViewport = PDF.PDFPageViewport;
import PDFSource = PDF.PDFSource;
import PDFTreeNode = PDF.PDFTreeNode;

declare var require: any;

export enum SearchState {
  FOUND,
  NOT_FOUND,
  WRAPPED,
  PENDING
}

enum ScalePriority {
  FULL,
  WIDTH,
  HEIGHT
}

if (typeof window !== 'undefined') {
  window['pdfjs-dist/build/pdf'] = require('pdfjs-dist/build/pdf');
  require('pdfjs-dist/web/compatibility');
  require('pdfjs-dist/web/pdf_viewer');
  PDFJS.verbosity = (<any>PDFJS).VERBOSITY_LEVELS.errors;
}

/**
 * PDF Viewer component created by SET
 */
@Component({
  selector: 'simple-pdf-viewer',
  template: `<div class="pdfViewerContainer" [hidden]="!isDocumentLoaded()"><div class="pdfViewer"></div></div>`,
  styleUrls: ['./simplePdfViewer.component.css']
})
export class SimplePdfViewerComponent implements OnInit {

  private static readonly CSS_UNITS: number = 96.0 / 72.0;
  private static readonly PAGE_RESIZE_BORDER_HEIGHT: number = 30;
  private static readonly PAGE_RESIZE_BORDER_WIDTH: number = 50;
  private static readonly ZOOM_UNIT = 0.1;
  private static readonly MAX_ZOOM = 5; // max. zoom 500%
  private static readonly MIN_ZOOM = 0.05; // min. zoom 5%
  private static readonly PDF_FINDER_FIND_COMMAND = 'find';
  private static readonly PDF_FINDER_AGAIN_COMMAND = 'again';
  private static readonly PDF_VIEWER_DEFAULT_SCALE = 'page-fit';

  /**
   * Source of the PDF document (Required)
   */
  @Input() src: string | Uint8Array | PDFSource;

  /**
   * The document will be opened at this page first (Optional)
   * @type {number}
   */
  @Input() startPage: number = 1;

  /**
   * Disable the rendering of the text layer (Optional)
   * @type {boolean}
   */
  @Input() disableTextLayer: boolean = false;

  @Output('onLoadComplete') onLoadComplete = new EventEmitter<PDFDocumentProxy>();
  @Output('onError') onError = new EventEmitter<any>();
  @Output('onProgress') onProgress = new EventEmitter<PDFProgressData>();
  @Output('onSearchStateChange') onSearchStateChange = new EventEmitter<SearchState>();

  private loaded: boolean = false;
  private currentPage: number = 1;
  private numberOfPages: number = 1;
  private outline: PDFTreeNode[] = [];
  private zoom: number = 1.0;
  private rotation: number = 0;

  private pdf: PDFDocumentProxy;
  private pdfLinkService: any;
  private pdfViewer: any;
  private pdfFindController: any;

  private searching: boolean = false;
  private lastSearchText: string = '';
  private searchPrevious: boolean = false;
  private searchCaseSensitive: boolean = false;

  constructor(private element: ElementRef) {
  }

  /**
   * Init angular component
   */
  public ngOnInit() {
    if (typeof window !== 'undefined') {
      if (typeof PDFJS.workerSrc !== 'string') {
        const workerUrl = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${ (PDFJS as any).version }/pdf.worker.min.js`;
        PDFJS.workerSrc = workerUrl;
      }
      this.initPDFJS();
      this.loadFile();
    }
  }

  /**
   * Open a PDF document at the specified page (at the first page by default)
   * @param src Source of the PDF document
   * @param page The specified page where should start
   */
  public openDocument(src: string | Uint8Array | PDFSource, page?: number): void {
    if (page) {
      this.startPage = parseInt(`${page}`, 10);
    }
    if (!page || !this.startPage) {
      this.startPage = 1;
    }
    this.src = src;
    if (this.pdfFindController) {
      this.pdfFindController.reset();
    }
    this.loadFile();
  }

  /**
   * Returns whether the PDF document is loaded properly
   * @returns {boolean} true if document is loaded
   */
  public isDocumentLoaded(): boolean {
    return this.loaded;
  }

  /**
   * Init PDFjs releated entries
   */
  private initPDFJS() {
    (<any>PDFJS).disableTextLayer = this.disableTextLayer;
    this.pdfLinkService = new (<any>PDFJS).PDFLinkService();

    this.pdfViewer = new (<any>PDFJS).PDFSinglePageViewer({
      container: this.getContainer(),
      removePageBorders: false,
      linkService: this.pdfLinkService,
    });
    this.pdfLinkService.setViewer(this.pdfViewer);

    this.pdfFindController = new (<any>PDFJS).PDFFindController({
      pdfViewer: this.pdfViewer
    });
    this.pdfViewer.setFindController(this.pdfFindController);
  }

  /**
   * Load the specified document
   */
  private loadFile() {
    this.loaded = false;
    if (this.src) {

      let progressSrc: any;
      if (typeof this.src === 'string') {
        progressSrc = PDFJS.getDocument({url: this.src, withCredentials: true} as any);
      } else {
        progressSrc = PDFJS.getDocument(this.src as any);
      }

      // progress
      progressSrc.onProgress = (progressData: PDFProgressData) => {
        this.onProgress.emit(progressData);
      };

      // loaded
      (<PDFPromise<PDFDocumentProxy>>progressSrc.promise).then(pdfDocument => {
        const container = this.getContainer();
        this.pdfViewer.setDocument(pdfDocument);
        this.pdfViewer.currentScaleValue = SimplePdfViewerComponent.PDF_VIEWER_DEFAULT_SCALE;
        this.pdfLinkService.setDocument(pdfDocument, null);
        this.pdf = pdfDocument;
        this.pdf.getOutline().then((outline: PDFTreeNode[]) => {
          this.outline = outline;
        });

        this.currentPage = 1;
        this.zoom = 1;
        this.numberOfPages = this.pdf.numPages;
        this.loaded = true;

        container.addEventListener('pagesinit', () => {
          this.pdfViewer.currentScaleValue = SimplePdfViewerComponent.PDF_VIEWER_DEFAULT_SCALE;
          this.zoomFullPage();
          if (this.startPage !== 1) {
            this.navigateToPage(this.startPage);
          }
          this.onLoadComplete.emit(pdfDocument);
        });

        container.addEventListener('pagechange', () => {
          this.currentPage = this.pdfViewer._currentPageNumber;
          this.zoom = this.pdfViewer._currentScale;
        });

      }, (error: any) => {
        this.onError.emit(error);
      });
    }
  }

  /**
   * Returns the HTML container element of the component
   * @returns {HTMLElement} container
   */
  private getContainer(): HTMLElement {
    return this.element.nativeElement.querySelector('div') as HTMLElement;
  }

  /* ***************************************************
   * RESIZING AND ZOOMING
   ***************************************************/

  /**
   * Returns the value of the viewport scale
   * @returns {number} scale of the PDF viewport
   */
  public getZoom(): number {
    return this.zoom;
  }

  /**
   * Increases the scale of the PDF viewport
   */
  public zoomIn(): void {
    if (this.isDocumentLoaded()) {
      this.zoom += SimplePdfViewerComponent.ZOOM_UNIT;
      this.setZoom(this.zoom);
    }
  }

  /**
   * Decreases the scale of the PDF viewport
   */
  public zoomOut(): void {
    if (this.isDocumentLoaded()) {
      this.zoom -= SimplePdfViewerComponent.ZOOM_UNIT;
      this.setZoom(this.zoom);
    }
  }

  /**
   * Sets the original viewport scale back to 1.0
   */
  public zoomReset(): void {
    if (this.isDocumentLoaded()) {
      this.zoom = 1.0;
      this.setZoom(this.zoom);
    }
  }

  /**
   * Sets the scale of the PDF viewport to fit in the actual screen
   */
  public zoomFullPage(): void {
    if (this.isDocumentLoaded()) {
      this.pdf.getPage(this.currentPage).then((page: PDFPageProxy) => {
        const scale = this.getScale(page.getViewport(1, this.rotation), ScalePriority.FULL);
        this.setZoom(scale);
      });
    }
  }

  /**
   * Sets the scale of the PDF viewport to fit in the actual screen (width priority)
   */
  public zoomPageWidth(): void {
    if (this.isDocumentLoaded()) {
      this.pdf.getPage(this.currentPage).then((page: PDFPageProxy) => {
        const scale = this.getScale(page.getViewport(1, this.rotation), ScalePriority.WIDTH);
        this.setZoom(scale);
      });
    }
  }

  /**
   * Sets the scale of the PDF viewport to fit in the actual screen (width priority)
   */
  public zoomPageHeight(): void {
    if (this.isDocumentLoaded()) {
      this.pdf.getPage(this.currentPage).then((page: PDFPageProxy) => {
        const scale = this.getScale(page.getViewport(1, this.rotation), ScalePriority.HEIGHT);
        this.setZoom(scale);
      });
    }
  }

  /**
   * Get the proper scale of the actual viewport to fit
   * @param viewport actual viewport
   * @returns {number} the fit scale
   */
  private getScale(viewport: PDFPageViewport, priority: ScalePriority = ScalePriority.FULL): number {
    const offsetHeight = this.getContainer().offsetHeight;
    const offsetWidth = this.getContainer().offsetWidth;
    if (offsetHeight === 0 || offsetWidth === 0) {
      return 1;
    }
    const heightRatio = (offsetHeight - SimplePdfViewerComponent.PAGE_RESIZE_BORDER_HEIGHT) / viewport.height;
    const widthRatio = (offsetWidth - SimplePdfViewerComponent.PAGE_RESIZE_BORDER_WIDTH) / viewport.width;
    let ratio = heightRatio < widthRatio ? heightRatio : widthRatio;
    if (priority !== ScalePriority.FULL) {
      ratio = priority === ScalePriority.WIDTH ? widthRatio : heightRatio;
    }
    const zoom = 1;
    return Math.floor(zoom * ratio / SimplePdfViewerComponent.CSS_UNITS * 100) / 100;
  }

  /**
   * Set the zoom of the document
   * @param scale The zoom value in double
   */
  public setZoom(scale: number): void {
    if (this.isDocumentLoaded() && typeof scale === 'number') {
      const normalizedScale = this.normalizeScale(scale);
      this.pdfViewer._setScale(normalizedScale, false);
      this.zoom = normalizedScale;
    }
  }

  /**
   * Set the scale of the document
   * @param zoom The scale value in percent
   */
  public setZoomInPercent(zoom: number): void {
    if (this.isDocumentLoaded() && typeof zoom === 'number') {
      this.setZoom(zoom / 100);
    }
  }

  /**
   * Normalize the scale to fit in the scale boundary
   * @param scale
   * @returns {number} the normalized scale value
   */
  private normalizeScale(scale): number {
    let normalizedScale = scale;
    if (scale > SimplePdfViewerComponent.MAX_ZOOM) {
      normalizedScale = SimplePdfViewerComponent.MAX_ZOOM;
    } else if (scale < SimplePdfViewerComponent.MIN_ZOOM) {
      normalizedScale = SimplePdfViewerComponent.MIN_ZOOM;
    }
    return normalizedScale;
  }

  /* ***************************************************
   * SEARCHING
   ***************************************************/

  /**
   * Starts case sensitive/insensitive text search and navigate to the first match (from the actual page)
   * @param text searched text
   * @param caseSensitive set true to use case sensitive searching
   */
  public search(text: string, caseSensitive: boolean = false): string {
    if (this.isDocumentLoaded()) {
      const searchText = text ? this.removeSpecialChars(text) : '';
      if (!searchText) {
        return searchText;
      }
      this.lastSearchText = text;
      this.searchPrevious = false;
      this.searchCaseSensitive = caseSensitive;
      this.pdfFindController.onUpdateResultsCount = this.onUpdateResultsCount.bind(this);
      this.pdfFindController.onUpdateState = this.onUpdateState.bind(this);
      this.pdfFindController.executeCommand(SimplePdfViewerComponent.PDF_FINDER_FIND_COMMAND, {
        caseSensitive: this.searchCaseSensitive,
        findPrevious: false,
        highlightAll: true,
        phraseSearch: true,
        query: searchText
      });
      return searchText;
    }
    return text;
  }

  /**
   * Removes special characters from the input string and also trim it
   * @param text Text should be normlaized
   * @returns {string} The normalized text
   */
  private removeSpecialChars(text: string) {
    return text ? text.replace(/[`~!#$%^&*()_|+\-=?;:'",<>\{\}\[\]\\\/]/gi, '').trim() : '';
  }

  /**
   * Navigates to the next search match if there were multiple hits
   */
  public nextMatch(): void {
    this.stepMatch(false);
  }

  /**
   * Navigates to the previous search match if there were multiple hits
   */
  public previousMatch(): void {
    this.stepMatch(true);
  }

  /**
   * Navigates to the next or previous search match if there were multiple hits
   * @param findPrevious set true to the previous match
   */
  private stepMatch(findPrevious: boolean): void {
    if (this.isDocumentLoaded() && this.getNumberOfMatches() > 1) {
      if (this.searchPrevious !== findPrevious) {
        this.searchPrevious = findPrevious;
        this.searchAgain();
      } else {
        this.pdfFindController.nextMatch();
        this.currentPage = this.pdfViewer._currentPageNumber;
      }
    }
  }

  /**
   * Search again with the updated configuration
   */
  private searchAgain(): void {
    if (this.isDocumentLoaded()) {
      this.pdfFindController.executeCommand(SimplePdfViewerComponent.PDF_FINDER_AGAIN_COMMAND, {
        caseSensitive: this.searchCaseSensitive,
        findPrevious: this.searchPrevious,
        highlightAll: true,
        phraseSearch: true,
        query: this.lastSearchText
      });
    }
  }

  /**
   * Returns the number of the search hits
   * @returns {number} the number of matched result
   */
  public getNumberOfMatches(): number {
    if (this.isDocumentLoaded()) {
      return this.pdfFindController.matchCount;
    }
    return 0;
  }

  /**
   * Returns whether there is a matched item
   * @returns {boolean} true if there was matched item
   */
  public hasMatches(): boolean {
    return this.getNumberOfMatches() > 0;
  }

  /**
   * Returns whether the search is in-progress
   * @returns {boolean} true if searching operation is in-progress
   */
  public isSearching(): boolean {
    return this.searching;
  }

  /**
   * Called if the search result count is updated. It triggers the onUpdateResultsCount
   * emitter.
   */
  private onUpdateResultsCount(): void {
    this.pdfFindController.onUpdateResultsCount = null;
    this.currentPage = this.pdfViewer._currentPageNumber;
  }

  /**
   * Called if the search state is updated. It triggers the onUpdateState
   * emitter.
   * @param state the state of the current search
   */
  private onUpdateState(state: SearchState): void {
    this.onSearchStateChange.emit(state);
    this.searching = state === SearchState.PENDING;
    if (!this.searching) {
      this.pdfFindController.onUpdateState = null;
    }
  }

  /* ***************************************************
   * NAVIGATION
   ***************************************************/

  /**
   * Returns the number of the actual page
   * @returns {number} the number of actual page
   */
  public getCurrentPage(): number {
    return this.currentPage;
  }

  /**
   * Returns the number of the pages
   * @returns {number} the length of the document
   */
  public getNumberOfPages(): number {
    return this.numberOfPages;
  }

  /**
   * Returns outline / table of content in tree structure
   * @returns {any[]|Array} the outline of the document
   */
  public getOutline(): PDFTreeNode[] {
    return this.outline ? this.outline : [];
  }

  /**
   * Returns whether the outline is available
   * @returns {boolean} true if outline is available
   */
  public hasOutline(): boolean {
    return this.loaded && !!this.outline && !!this.outline.length;
  }

  /**
   * Navigates to the specified (outline) destination
   * @param destination the destination object of the outline item
   */
  public navigateToDestination(destination: any): void {
    if (this.isDocumentLoaded()) {
      // TODO: input validation
      this.pdfLinkService.navigateTo(destination);
    }
  }

  /**
   * Navigates to the first page
   */
  public firstPage(): void {
    if (this.isDocumentLoaded()) {
      this.currentPage = 1;
      this.navigateToPage(this.currentPage);
    }
  }

  /**
   * Navigates to the last page
   */
  public lastPage(): void {
    if (this.isDocumentLoaded()) {
      this.currentPage = this.getNumberOfPages();
      this.navigateToPage(this.currentPage);
    }
  }

  /**
   * Navigates to the next page
   */
  public nextPage(): void {
    if (this.isDocumentLoaded()) {
      this.currentPage++;
      this.navigateToPage(this.currentPage);
    }
  }

  /**
   * Navigates to the previous page
   */
  public prevPage(): void {
    if (this.isDocumentLoaded()) {
      this.currentPage--;
      this.navigateToPage(this.currentPage);
    }
  }

  /**
   * Navigates to the specified page
   * @param page the number of the page
   */
  public navigateToPage(page?: number): void {
    if (this.isDocumentLoaded()) {
      if (page) {
        const pageInt = parseInt(`${page}`, 10);
        this.currentPage = pageInt ? pageInt : this.currentPage;
      }
      if (this.currentPage > this.numberOfPages) {
        this.currentPage = 1;
      }
      if (this.currentPage <= 0) {
        this.currentPage = this.numberOfPages;
      }
      this.pdfViewer.scrollPageIntoView({
        pageNumber: this.currentPage
      });
    }
  }

  /* ***************************************************
   * ROTATION
   ***************************************************/

  /**
   * Sets the rotation to the default 0 degree
   */
  public resetRotation(): void {
    this.rotate(0);
  }

  /**
   * Turns left the document with 90 degree (counterclockwise)
   */
  public turnLeft(): void {
    this.rotate(this.rotation - 90);
  }

  /**
   * Turns right the document with 90 degree (clockwise)
   */
  public turnRight(): void {
    this.rotate(this.rotation + 90);
  }

  /**
   * Returns the actual rotation value in degree
   */
  public getRotation(): number {
    return this.rotation;
  }

  /**
   * Rotate the document with the specified angle (can be negative)
   * @param angle rotation angle
   */
  private rotate(angle: number = 90): void {
    if (this.isDocumentLoaded()) {
      this.rotation = parseInt(`${angle}`, 10);
      this.pdfViewer.pagesRotation = this.rotation;
    }
  }
}