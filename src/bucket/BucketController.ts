import {Bucket} from './../common/Bucket';
import {Path} from './../common/Path';
import {IBucketObject} from './../common/IBucketObject';
import {File} from './../common/File';
import {Folder} from './../common/Folder';
import {IFolderContents} from './../common/IFolderContents';
import {IUploadConfig} from './../common/IUploadConfig';
import {IBackend} from './../common/IBackend';
import {AmazonS3Backend} from './../common/AmazonS3Backend';

export class BucketController {
  /**
   * Dependencies we want passed to the constructor.
   * @see http://docs.angularjs.org/guide/di
   */
  public static $inject = [
    '$rootScope'
  ];

  /**
   * Backend name. Passed in as component binding.
   */
  public backendName: string;

  /**
   * Bucket name. Passed in as a component binding.
   */
  public bucketName: string;

  /**
   * Allow Download. Flag indicating whether to allow file download.
   */
  public allowDownload: boolean;

  /**
   * AWS region. Passed in as a component binding.
   */
  public awsRegion: string;

  /**
   * AWS Access Key ID. Passed in as a component binding.
   */
  public awsAccessKeyId: string;

  /**
   * AWS Secret Access Key. Passed in as a component binding.
   */
  public awsSecretAccessKey: string;

  /**
   * AWS Session Token. Passed in as a component binding.
   */
  public awsSessionToken: string;

  /**
   * AWS bucket prefix for a folder. Passed in as a component binding.
   */
  public awsBucketPrefix: string;

  /**
   * Flag used to indicate a background operation is running.
   */
  public working: boolean;

  /**
   * Error encountered running background operation.
   */
  public error: Error;

  /**
   * Bucket.
   */
  public bucket: Bucket;

  /**
   * Display deleted files in the folder.
   */
  public showDeleted: boolean;

  /**
   * Current working folder.
   */
  public currentFolder: Folder;

  /**
   * Folder objects in the current working path.
   */
  public folders: Folder[];

  /**
   * File objects in the current working path.
   */
  public files: File[];

  /**
   * Deleted folder objects in the current working path.
   */
  public deletedFolders: Folder[];

  /**
   * deleted file objects in the current working path.
   */
  public deletedFiles: File[];

  /**
   * Settings for uploading files.
   */
  public uploadConfig: IUploadConfig;

  /**
   * Used to specify the name of new folders.
   */
  public folderName: string;

  /**
   * Backend.
   */
  private backend: IBackend;

  /**
   * Create an instance of the controller.
   */
  constructor(private $rootScope: ng.IScope) {
    this.working = false;
    this.error = null;
    this.bucket = null;
    this.showDeleted = false;
    this.folders = [];
    this.deletedFolders = [];
    this.files = [];
    this.deletedFiles = [];
    this.uploadConfig = null;
    this.folderName = '';

    // regenerate the backend on access key change.
    $rootScope.$watch(
      (): string => {
        return this.awsAccessKeyId;
      },
      (newVal: string, oldVal: string): void => {
        this.regenerateBackend();
      }
    );
  }

  /**
   * Initialize the controller.
   */
  $onInit() {
    // set the currentFolder based on bucket prefix
    if (this.awsBucketPrefix === undefined) {
      this.awsBucketPrefix = '/';
    }
    this.currentFolder = new Folder(new Path(this.awsBucketPrefix));

    // default session token to None
    if (this.awsSessionToken === undefined) {
      this.awsSessionToken = null;
    }

    // default allow download to true
    if (this.allowDownload === undefined) {
      this.allowDownload = true;
    }

    // initial load
    this.regenerateBackend();
  }

  /**
   * Create the backend and load the contents.
   */
  public regenerateBackend(): void {
    if (this.backendName === 's3') {
      this.backend = new AmazonS3Backend(
        this.awsRegion,
        this.awsAccessKeyId,
        this.awsSecretAccessKey,
        this.awsSessionToken,
        this.allowDownload);
    } else {
      throw new Error(`Unknown backend: ${this.backendName}`);
    }
    this.loadContents();
  }

  /**
   * Load bucket and objects at working path.
   */
  public loadContents(): Promise<any> {
    this.working = true;
    this.error = null;
    return this.backend.getBucket(this.bucketName)
      .then((bucket: Bucket) => {
        // store bucket
        this.bucket = bucket;

        // retrieve upload settings
        this.uploadConfig = this.backend.getUploadConfig(
          this.bucket,
          this.currentFolder);

        // load current folder contents
        return this.backend.getContents(bucket, this.currentFolder);
      })
      .then((contents: IFolderContents) => {
        function compareObjectNames (a: IBucketObject, b: IBucketObject) {
          var nameA = a.getPath().name().toLowerCase();
          var nameB = b.getPath().name().toLowerCase();

          if (nameA < nameB) {
            return -1;
          }

          if (nameA > nameB) {
            return 1;
          }

          return 0;
        }

        // store folders and files in alphabetical order
        this.folders = contents.folders.sort(compareObjectNames);
        this.files = contents.files.sort(compareObjectNames);

        return this.backend.getDeletedContents(this.bucket, this.currentFolder)
          .then((contents: IFolderContents) => {
            // deleted folders don't get deleted markers so we have to
            // cross reference the folders that come back from getDeletedContents
            // with the folders that come back from getContents. We only want the
            // folders that don't get returned by getContents.
            contents.folders = contents.folders.filter((folder: Folder) => {
              for (var i = 0; i < this.folders.length; i++) {
                if (this.folders[i].getPath().equals(folder.getPath())) {
                  return false;
                }
              }
              return true;
            });

            return contents;
          })
          .then((contents: IFolderContents) => {
            function compareObjectNames (a: IBucketObject, b: IBucketObject) {
              var nameA = a.getPath().name().toLowerCase();
              var nameB = b.getPath().name().toLowerCase();

              if (nameA < nameB) {
                return -1;
              }

              if (nameA > nameB) {
                return 1;
              }

              return 0;
            }

            // store folders and files in alphabetical order
            this.deletedFolders = contents.folders.sort(compareObjectNames);
            this.deletedFiles = contents.files.sort(compareObjectNames);
          })
          .catch((error: Error) => {
            // display the error
            this.error = error;
          });
      })
      .catch((error: Error) => {
        // display the error
        this.error = error;
      })
      .then(() => {
        this.working = false;

        // apply scope changes. because we're using $ctrl instead of $scope in
        // the template we need to update the parent scope somehow.
        this.$rootScope.$digest();
      });
  }

  /**
   * Toggle the working status of this bucket. Useful for toggling callbacks.
   */
  public toggleWorking(state: boolean) {
    this.working = state;
    // apply scope changes
    this.$rootScope.$digest();
  }

  /**
   * Navigate to a folder.
   */
  public navigateFolder(folder: Folder): Promise<any> {
    this.currentFolder = folder;
    return this.loadContents();
  }

  /**
   * Navigate to the parent folder.
   */
  public navigateParent(): Promise<any> {
    this.currentFolder = this.currentFolder.parent();
    return this.loadContents();
  }

  /**
   * Create a folder.
   */
  public createFolder(): Promise<any> {
    // corner case: invalid folder name
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions
    let folderRegex = new RegExp('^[\\w\\.\\-]+$');
    if (!folderRegex.test(this.folderName)) {
      this.error = new Error('Invalid folder name!');
      return;
    }

    let folderPath = this.currentFolder.getPath()
      .clone()
      .push(`${this.folderName}/`);

    this.working = true;
    this.error = null;
    return this.backend.createFolder(this.bucket, new Folder(folderPath))
      .then(() => {
        this.folderName = '';
        return this.loadContents();
      })
      .catch(() => {
        this.error = new Error('Failed to create folder');
      });
  }

  /**
   * Delete a folder and it's contents.
   */
  public deleteFolder(folder: Folder): Promise<any> {
    this.working = true;
    this.error = null;
    return this.backend.deleteFolder(this.bucket, folder)
      .then(() => {
        return this.loadContents();
      })
      .catch(() => {
        this.error = new Error('Failed to delete folder');
      });
  }

  /**
   * Load file versions.
   */
  public loadFileVersions(file: File): Promise<any> {
    return this.backend.getFileVersions(this.bucket, file);
  }

  /**
   * Delete a file.
   */
  public deleteFile(file: File) {
    this.working = true;
    this.error = null;
    return this.backend.deleteFile(this.bucket, file)
      .then(() => {
        return this.loadContents();
      })
      .catch(() => {
        this.error = new Error('Failed to delete file');
      });
  }

  /**
   * Returns true if the current folder is at the bucket prefix
   */
  public isAtBucketPrefix(): boolean {
    return this.currentFolder.getPath().toString() === this.awsBucketPrefix;
  }
}
